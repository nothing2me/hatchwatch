import { describe, expect, it } from 'vitest';
import { CameraDangerThrottle, cameraDangerMessage, cameraDangerNote, qualifyingPerson } from '@/lib/detections/cameraDanger';
import type { DetectionsView } from '@/lib/types';

const T = 1_760_000_000_000;
const result = (objects: DetectionsView['objects'], trails: DetectionsView['trails']): DetectionsView => ({ at: T, dark: false, width: 320, height: 240, objects, trails });
const person = (track: string, score: number) => ({ track, label: 'person' as const, score, box: [1, 2, 3, 4] as [number, number, number, number] });
const trail = (track: string, spanMs: number, label: 'person' | 'possible turtle' = 'person') => ({ track, label, points: [[T - spanMs, 1, 1], [T - spanMs / 2, 2, 1], [T, 3, 1]] as [number, number, number][] });

describe('camera danger rule', () =>
{
    it('needs a person seen for 2 s with score 0.50 in this result', () =>
    {
        expect(qualifyingPerson(result([person('P1', 0.5)], [trail('P1', 2_000)]))).toEqual({ track: 'P1', score: 0.5 });
        expect(qualifyingPerson(result([person('P1', 0.49)], [trail('P1', 5_000)]))).toBeNull();
        expect(qualifyingPerson(result([person('P1', 0.9)], [trail('P1', 1_999)]))).toBeNull();
        expect(qualifyingPerson(result([], [trail('P1', 5_000)]))).toBeNull();                      // trail only: not seen now
        expect(qualifyingPerson(result([{ track: 'T1', label: 'possible turtle', box: [1, 2, 3, 4] }], [trail('T1', 9_000, 'possible turtle')]))).toBeNull();
        expect(qualifyingPerson(result([person('P1', 0.9), person('P2', 0.6)], [trail('P1', 2_500), trail('P2', 8_000)]))).toEqual({ track: 'P2', score: 0.6 });
    });

    it('uses the exact wording', () =>
    {
        expect(cameraDangerMessage('A1')).toBe('Danger · person seen on camera A1 near active nest sites — check now');
        expect(cameraDangerNote('A1', 'P3', 2, 'A')).toBe('Person on camera A1 (track P3), 2 active unprotected site(s) in zone A');
    });

    it('lets each camera through at most once every 5 s', () =>
    {
        const throttle = new CameraDangerThrottle();
        expect(throttle.take('c1', T)).toBe(true);
        expect(throttle.take('c1', T + 4_999)).toBe(false);
        expect(throttle.take('c2', T + 1)).toBe(true);
        expect(throttle.take('c1', T + 5_000)).toBe(true);
        expect(throttle.take('c1', T + 9_999)).toBe(false);
        expect(throttle.take('c1', T + 10_000)).toBe(true);
    });
});
