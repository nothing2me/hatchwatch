import hashlib, json, subprocess
from pathlib import Path
import cv2
import imageio_ffmpeg
import numpy as np

def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False), encoding='utf-8')

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()

def writer(path, width, height, fps):
    return subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), '-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{width}x{height}','-r',str(fps),'-i','-','-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',str(path)], stdin=subprocess.PIPE)

def ground_homography(cal, w, h):
    points=cal['reference_points']; src=np.float32([p['pixel'] for p in points]); world=np.float32([p['world'] for p in points])
    dst=(world+np.array([8,6],np.float32))*np.array([(w-1)/16,(h-1)/12],np.float32)
    H,_=cv2.findHomography(src,dst,0)
    mapped=cv2.perspectiveTransform(src[None],H)[0]
    error=float(np.sqrt(np.mean(np.sum(((mapped-dst)*[16/(w-1),12/(h-1)])**2,axis=1))))
    return H,error
