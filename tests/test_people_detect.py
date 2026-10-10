import json

import cv2
import numpy as np

from scripts import people_detect

FOV = 50.0


def _look_at_quat(eye, target):
    """three.js camera lookAt: the camera looks along its local -Z."""
    z = np.asarray(eye, float) - np.asarray(target, float)
    z /= np.linalg.norm(z)
    x = np.cross([0.0, 1.0, 0.0], z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    m = np.column_stack([x, y, z])
    w = np.sqrt(max(0.0, 1 + m[0, 0] + m[1, 1] + m[2, 2])) / 2
    qx = (m[2, 1] - m[1, 2]) / (4 * w)
    qy = (m[0, 2] - m[2, 0]) / (4 * w)
    qz = (m[1, 0] - m[0, 1]) / (4 * w)
    return [qx, qy, qz, w], m


def _project(eye, rot, w, h, p):
    cam = rot.T @ (np.asarray(p, float) - np.asarray(eye, float))
    t = np.tan(np.radians(FOV) / 2)
    nx = (cam[0] / -cam[2]) / (t * w / h)
    ny = (cam[1] / -cam[2]) / t
    return ((nx + 1) * w / 2, (1 - ny) * h / 2)


def _calibration(w=1280, h=720, eye=(0.0, 5.0, 10.0)):
    q, rot = _look_at_quat(eye, (0, 0, 0))
    refs = [{'world': [x, z], 'pixel': list(_project(eye, rot, w, h, (x, 0, z)))}
            for x in (-6, 0, 6) for z in (-6, 0, 6)]
    cal = {'width': w, 'height': h, 'mount_position_m': list(eye),
           'orientation_quaternion_xyzw': q, 'vertical_fov_degrees': FOV,
           'ground_bounds': [-12, 12, -8, 8], 'reference_points': refs}
    return cal, rot


def test_pixel_ray_centre_hits_origin():
    cal, _ = _calibration()
    o, d = people_detect.pixel_ray(cal, 640, 360)
    s = -o[1] / d[1]
    assert np.allclose(o + s * d, [0, 0, 0], atol=1e-3)


def test_blob_height_recovers_pole():
    cal, rot = _calibration()
    eye = cal['mount_position_m']
    for height in (1.8, 0.4):
        foot = _project(eye, rot, 1280, 720, (2, 0, 1))
        top = _project(eye, rot, 1280, 720, (2, height, 1))
        (gx, gz), hm = people_detect.blob_height(cal, foot, top)
        assert abs(gx - 2) <= 0.05 and abs(gz - 1) <= 0.05
        assert abs(hm - height) <= 0.05


def _synthetic_frames(cal, rot, n=48):
    w, h = cal['width'], cal['height']
    eye = cal['mount_position_m']
    frames = []
    for f in range(n):
        img = np.full((h, w, 3), 90, np.uint8)
        if f >= 16:
            k = f - 16
            # tall rectangle: 0.8 m wide, 1.8 m tall, walking along x at z = 2
            px = -4 + 0.18 * k
            corners = [(px - 0.4, 0, 2), (px + 0.4, 0, 2), (px + 0.4, 1.8, 2), (px - 0.4, 1.8, 2)]
            poly = np.array([_project(eye, rot, w, h, c) for c in corners], np.float32)
            cv2.fillPoly(img, [np.round(poly).astype(np.int32)], (230, 230, 230))
            # flat ellipse on the ground: 2.4 x 1.6 m, crawling along x at z = -3
            ex = 4 - 0.12 * k
            ring = [(ex + 1.2 * np.cos(a), 0, -3 + 0.8 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 24)]
            ell = np.array([_project(eye, rot, w, h, c) for c in ring], np.float32)
            cv2.fillPoly(img, [np.round(ell).astype(np.int32)], (20, 20, 20))
        frames.append(img)
    return frames


def _synthetic_doc():
    cal, rot = _calibration(64, 36, eye=(0.0, 5.0, 10.0))
    frames = _synthetic_frames(cal, rot)
    times = [f / 8 for f in range(len(frames))]
    return people_detect.detect_in_frames([(cal, frames), (cal, frames)], times)


def test_tall_rectangle_is_person_flat_ellipse_is_not():
    doc = _synthetic_doc()
    assert len(doc['people']) == 1
    person = doc['people'][0]
    assert person['max_height_m'] >= 1.2
    zs = [p[2] for p in person['points']]
    assert all(abs(z - 2) <= 1.0 for z in zs)


def test_schema_shape():
    doc = _synthetic_doc()
    schema = json.loads((people_detect.ROOT / 'schemas' / 'people.v1.json').read_text())
    try:
        import jsonschema
        jsonschema.validate(doc, schema)
    except ImportError:
        assert set(doc) == set(schema['required'])
        assert doc['schema'] == 'nesttrace.people' and doc['version'] == 1
        assert isinstance(doc['note'], str)
        for p in doc['people']:
            assert set(p) == {'id', 'points', 'max_height_m'}
            assert p['id'].startswith('person-')
            assert isinstance(p['max_height_m'], float)
            assert len(p['points']) >= 2 and all(len(q) == 3 for q in p['points'])


# ---- regression tests (review round 1) ----

def _poly(eye, rot, w, h, pts):
    return np.round(np.array([_project(eye, rot, w, h, p) for p in pts], np.float32)).astype(np.int32)


def _box(x, z, width, height):
    """Vertical rectangle facing the camera along +z."""
    return [(x - width / 2, 0, z), (x + width / 2, 0, z), (x + width / 2, height, z), (x - width / 2, height, z)]


def _ground_ellipse(x, z, rx, rz):
    return [(x + rx * np.cos(a), 0, z + rz * np.sin(a)) for a in np.linspace(0, 2 * np.pi, 32)]


def _render(cal, rot, n, draw):
    """Grey 720p frames; draw(img, k) paints frame k (k = frames since the background window)."""
    w, h = cal['width'], cal['height']
    frames = []
    for f in range(n):
        img = np.full((h, w), 90, np.uint8)
        if f >= people_detect.BACKGROUND_FRAMES:
            draw(img, f - people_detect.BACKGROUND_FRAMES)
        frames.append(img)
    return frames


def _last_blobs(cal, frames):
    out = list(people_detect._frame_blobs(cal, frames))
    return out[-1][2]


def test_line_of_sight_ground_strip_seen_by_one_view_is_not_a_person():
    cal, rot = _calibration()
    eye = cal['mount_position_m']

    def strip(img, k):  # disturbed-sand strip running away from camera A, flickering sparsely
        if k % 3 == 0:
            pts = [(1.85, 0, 2), (2.15, 0, 2), (2.15, 0, -4), (1.85, 0, -4)]
            cv2.fillPoly(img, [_poly(eye, rot, 1280, 720, pts)], 200 if (k // 3) % 2 else 20)

    frames = _render(cal, rot, people_detect.BACKGROUND_FRAMES + 30, strip)
    # per blob it does pass the height and aspect rules in view A ...
    hits = [b for _, _, blobs in people_detect._frame_blobs(cal, frames) for b in blobs if b[7]]
    assert hits and all(b[6] >= people_detect.PERSON_HEIGHT_M for b in hits)
    # ... but view B never sees it, and the single-view hits are sparse: no person track
    cal_b, rot_b = _calibration(eye=(-10.0, 5.0, 4.0))
    empty_b = _render(cal_b, rot_b, len(frames), lambda img, k: None)
    times = [f / 8 for f in range(len(frames))]
    doc = people_detect.detect_in_frames([(cal, frames), (cal_b, empty_b)], times)
    assert doc['people'] == []


def test_static_blob_after_background_window_is_dropped_by_motion_gate():
    cal, rot = _calibration()
    eye = cal['mount_position_m']
    frames = _render(cal, rot, people_detect.BACKGROUND_FRAMES + 12,
                     lambda img, k: cv2.fillPoly(img, [_poly(eye, rot, 1280, 720, _box(1, 0, 0.6, 1.8))], 230))
    blobs = _last_blobs(cal, frames)
    assert not any(b[7] for b in blobs)
    times = [f / 8 for f in range(len(frames))]
    assert people_detect.detect_in_frames([(cal, frames), (cal, frames)], times)['people'] == []


def test_tall_but_wide_blob_rejected_and_person_touching_turtle_split():
    cal, rot = _calibration()
    eye = cal['mount_position_m']

    rng = np.random.default_rng(0)

    def wide(img, k):  # 3 m wide, 1.5 m tall textured moving object: tall enough, far too wide
        m = np.zeros_like(img)
        cv2.fillPoly(m, [_poly(eye, rot, 1280, 720, _box(-4 + 0.15 * k, 0, 3.0, 1.5))], 1)
        img[m > 0] = rng.integers(150, 256, int(m.sum()), dtype=np.uint8)

    blobs = _last_blobs(cal, _render(cal, rot, people_detect.BACKGROUND_FRAMES + 6, wide))
    assert blobs and max(b[6] for b in blobs) >= people_detect.PERSON_HEIGHT_M
    assert not any(b[7] for b in blobs)

    def touching(img, k):  # person beside a turtle, joined by a 2 px "flipper"
        x = 0.15 * k
        person = _poly(eye, rot, 1280, 720, _box(x, 0, 0.6, 1.8))
        turtle = _poly(eye, rot, 1280, 720, _ground_ellipse(x + 1.6, 0.5, 1.0, 0.7))
        cv2.fillPoly(img, [person], 230)
        cv2.fillPoly(img, [turtle], 20)
        a = (int(person[:, 0].max()), int(person[:, 1].max()) - 5)
        b = (int(turtle[:, 0].min()) + 3, int(turtle[:, 1].mean()))
        cv2.line(img, a, b, 230, 2)

    blobs = _last_blobs(cal, _render(cal, rot, people_detect.BACKGROUND_FRAMES + 6, touching))
    people = [b for b in blobs if b[7]]
    assert len(people) == 1
    assert abs(people[0][4] - 0.75) <= 0.6 and abs(people[0][5]) <= 0.6


def test_cross_view_agreement_rule():
    times = [f / 8 for f in range(40)]
    empty = [[] for _ in times]

    def walk(frames_on, x0=0.0):
        out = [[] for _ in times]
        for f in frames_on:
            out[f] = [(x0 + 0.15 * f, 1.0, 1.8)]
        return out

    dense = range(5, 25)
    sparse = range(5, 30, 5)  # 5 hits, one every 5 frames
    # seen by both cameras: kept even though each view is sparse-ish
    both = people_detect._people_tracks([walk(range(5, 25, 2)), walk(range(5, 25, 2))], times)
    assert len(both) == 1
    # one camera, sparse hits: dropped
    assert people_detect._people_tracks([walk(sparse), empty], times) == []
    # one camera, dense hits (single-camera coverage): kept
    assert len(people_detect._people_tracks([walk(dense), empty], times)) == 1
    # two cameras that disagree by more than FUSE_M never confirm each other
    far = walk(sparse, x0=3.0)
    assert people_detect._people_tracks([walk(sparse), far], times) == []


def test_missing_calibration_key_is_a_clean_exit():
    import pytest
    cal, rot = _calibration(64, 36)
    del cal['vertical_fov_degrees']
    with pytest.raises(SystemExit, match='vertical_fov_degrees'):
        people_detect.detect_in_frames([(cal, [])], [])


# ---- fragmentation regressions (review round 2) ----

T80 = [f / 8 for f in range(80)]


def _views(paths, frames=range(80), jitter=0.0):
    """paths: list of f -> (x, z). Both views see every path; view 1's foot jumps by `jitter` m on odd frames."""
    v0, v1 = [[] for _ in T80], [[] for _ in T80]
    for f in frames:
        for path in paths:
            x, z = path(f)
            v0[f].append((x, z, 1.8))
            v1[f].append((x, z + (jitter if f % 2 else 0.0), 1.8))
    return [v0, v1]


def test_two_view_foot_jitter_is_one_person():
    tracks = people_detect._people_tracks(_views([lambda f: (-8 + 0.17 * f, 1.0)], jitter=1.5), T80)
    assert len(tracks) == 1


def test_dropout_of_one_and_a_half_seconds_is_one_person():
    frames = [f for f in range(80) if not 30 <= f < 42]  # 12 frames = 1.5 s missing in both views
    tracks = people_detect._people_tracks(_views([lambda f: (-8 + 0.17 * f, 1.0)], frames), T80)
    assert len(tracks) == 1
    assert tracks[0][0][0] <= 0.01 and tracks[0][-1][0] >= 9.8


def test_two_walkers_six_metres_apart_are_two_people():
    paths = [lambda f: (-8 + 0.17 * f, -3.0), lambda f: (5 - 0.17 * f, 3.0)]
    tracks = people_detect._people_tracks(_views(paths), T80)
    assert len(tracks) == 2
