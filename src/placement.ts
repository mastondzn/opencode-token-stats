export type Placement = 'composer' | 'overlay' | 'footer' | 'footer-compact';

export interface PlacementDefinition {
    readonly id: Placement;
    readonly label: string;
    readonly description: string;
}

export const DEFAULT_PLACEMENT: Placement = 'composer';

export const PLACEMENTS: readonly PlacementDefinition[] = [
    {
        id: 'composer',
        label: 'Above prompt',
        description: 'Full-width line above the composer; the native footer stays intact',
    },
    {
        id: 'overlay',
        label: 'Input overlay',
        description: 'Inside the prompt box, bottom-right, like oc-tps',
    },
    {
        id: 'footer',
        label: 'Footer, full',
        description: 'Native footer row; full stats line, but native footer content may clip',
    },
    {
        id: 'footer-compact',
        label: 'Footer, compact',
        description: 'Native footer row; native footer stays intact, but stats may truncate',
    },
];

const PLACEMENT_IDS = new Set<string>(PLACEMENTS.map((placement) => placement.id));

export function isPlacement(value: unknown): value is Placement {
    return typeof value === 'string' && PLACEMENT_IDS.has(value);
}

export function normalizePlacement(value: unknown): Placement {
    return isPlacement(value) ? value : DEFAULT_PLACEMENT;
}

export function nextPlacement(value: Placement): Placement {
    const index = PLACEMENTS.findIndex((placement) => placement.id === value);
    const next = PLACEMENTS[(index + 1) % PLACEMENTS.length];
    return next?.id ?? DEFAULT_PLACEMENT;
}
