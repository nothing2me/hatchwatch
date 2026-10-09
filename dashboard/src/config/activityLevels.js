// The activity levels a zone can have, and how each one is drawn.
//
// Colors were picked so the levels differ in LIGHTNESS as well as hue,
// which keeps them readable for people with color blindness.

export const activityLevels =
{
    high:
    {
        label: 'High',
        mapFill: '#E2581F',      // Fill color of the zone on the map
        mapStroke: '#B8410F',    // Outline color of the zone on the map
        badgeBackground: '#B8410F',
        badgeText: '#FFFFFF',
    },
    medium:
    {
        label: 'Medium',
        mapFill: '#F0A63A',
        mapStroke: '#C98516',
        badgeBackground: '#F0A63A',
        badgeText: '#13232E',
    },
    low:
    {
        label: 'Low',
        mapFill: '#3B7DBF',
        mapStroke: '#2F6EAD',
        badgeBackground: '#2F6EAD',
        badgeText: '#FFFFFF',
    },
};

// The order levels appear in the map legend, from most to least active.
export const activityLevelOrder = ['high', 'medium', 'low'];
