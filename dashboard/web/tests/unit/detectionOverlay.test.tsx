import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DETECTION_NOTE, DetectionNote, DetectionOverlay, DetectionStatus, detectionCounts, objectLabel, trackColor } from '@/features/phones/DetectionOverlay';
import type { DetectionsView } from '@/lib/types';

afterEach(cleanup);

const detections: DetectionsView = {
    at: 3_000, dark: false, width: 320, height: 240,
    objects: [
        { track: 'P1', label: 'person', score: 0.8249, box: [194, 104, 31, 86] },
        { track: 'T1', label: 'possible turtle', box: [40, 120, 48, 24] },
    ],
    trails: [
        { track: 'P1', label: 'person', points: [[1_000, 200, 147], [2_000, 205, 147], [3_000, 210, 147]] },
        { track: 'T1', label: 'possible turtle', points: [[3_000, 64, 132]] },
    ],
};

describe('detection overlay', () =>
{
    it('draws boxes, labels and fading trails in picture pixels', () =>
    {
        const { container } = render(<DetectionOverlay detections={detections} />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 320 240');
        expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
        const person = container.querySelector('rect[data-track="P1"]')!;
        expect([person.getAttribute('x'), person.getAttribute('y'), person.getAttribute('width'), person.getAttribute('height')]).toEqual(['194', '104', '31', '86']);
        expect(person.getAttribute('stroke')).toBe(trackColor('P1'));
        expect(screen.getByText('person 0.82')).toBeTruthy();
        expect(screen.getByText('possible turtle')).toBeTruthy();
        const segments = [...container.querySelectorAll('line[data-track="P1"]')];
        expect(segments).toHaveLength(2);
        expect(Number(segments[0].getAttribute('stroke-opacity'))).toBeLessThan(Number(segments[1].getAttribute('stroke-opacity')));
        expect(segments[1].getAttribute('stroke-opacity')).toBe('1');
        expect(container.querySelectorAll('line[data-track="T1"]')).toHaveLength(0);
    });

    it('labels, colours and counts', () =>
    {
        expect(objectLabel(detections.objects[0])).toBe('person 0.82');
        expect(objectLabel(detections.objects[1])).toBe('possible turtle');
        expect(trackColor('P1')).not.toBe(trackColor('P2'));
        expect(trackColor('P1')).not.toBe(trackColor('T1'));
        expect(detectionCounts(detections)).toEqual({ people: 1, turtles: 1 });
    });

    it('says what the detector is doing', () =>
    {
        const { rerender } = render(<DetectionStatus detections={detections} />);
        expect(screen.getByText('People 1 · Possible turtles 1')).toBeTruthy();
        rerender(<DetectionStatus detections={null} />);
        expect(screen.getByText('Detection off')).toBeTruthy();
        rerender(<DetectionStatus detections={{ ...detections, dark: true, objects: [], trails: [] }} />);
        expect(screen.getByText('Too dark to detect')).toBeTruthy();
        rerender(<DetectionNote detections={detections} />);
        expect(screen.getByText(DETECTION_NOTE)).toBeTruthy();
        expect(DETECTION_NOTE).toBe('Detection is a viewing aid; it can miss people and mistake objects.');
        expect(screen.getByText(/Possible turtle \(rule\)/)).toBeTruthy();
        rerender(<DetectionNote detections={null} />);
        expect(screen.queryByText(DETECTION_NOTE)).toBeNull();
    });

    it('clamps boxes and trails to the picture and survives broken fields', () =>
    {
        const odd = {
            at: 1, dark: false, width: 320, height: 240,
            objects: [
                { track: 'P2', label: 'person', score: 0.5, box: [-10, 230, 50, 40] },
                { track: 'P3', label: 'person', box: [400, 10, 20, 20] },
                { track: 'P4', label: 'person', score: Number.NaN, box: [10, 10, Number.NaN, 20] },
                { track: 'X', label: 'person', box: [5, 5, 10, 10] },
            ],
            trails: [{ track: 'P2', label: 'person', points: [[0, -5, 300], [1, 15, 250]] }, { track: 'P9', label: 'person' }],
        } as unknown as DetectionsView;
        const { container } = render(<DetectionOverlay detections={odd} />);
        const clamped = container.querySelector('rect[data-track="P2"]')!;
        expect([clamped.getAttribute('x'), clamped.getAttribute('y'), clamped.getAttribute('width'), clamped.getAttribute('height')]).toEqual(['0', '230', '40', '10']);
        expect(container.querySelector('rect[data-track="P3"]')).toBeNull();
        expect(container.querySelector('rect[data-track="P4"]')).toBeNull();
        expect(container.querySelector('rect[data-track="X"]')!.getAttribute('stroke')).toMatch(/^#/);
        const line = container.querySelector('line[data-track="P2"]')!;
        expect([line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2'), line.getAttribute('y2')]).toEqual(['0', '240', '15', '240']);
        expect(objectLabel({ track: 'P3', label: 'person', box: [0, 0, 1, 1] })).toBe('person');

        const { container: empty } = render(<DetectionOverlay detections={{ at: 1, dark: false, width: 0, height: 0 } as unknown as DetectionsView} />);
        expect(empty.querySelector('svg')).toBeNull();
        expect(detectionCounts({ at: 1 } as unknown as DetectionsView)).toEqual({ people: 0, turtles: 0 });
    });

    it('marks a possible turtle as the rule, never a turtle', () =>
    {
        const { container } = render(<DetectionOverlay detections={detections} />);
        expect(container.querySelector('g[data-track="T1"] title')!.textContent).toBe('Possible turtle (rule)');
        expect(container.querySelector('g[data-track="P1"] title')).toBeNull();
    });
});
