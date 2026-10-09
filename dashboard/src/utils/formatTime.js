// Formats times for display. Everything is shown in the beach's local time
// (Corpus Christi / Port Aransas), no matter where the viewer is.

const beachTimeZone = 'America/Chicago';

const dateTimeFormatter = new Intl.DateTimeFormat('en-US',
{
    timeZone: beachTimeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

// "Oct 8, 10:42 PM", or a dash when there is no time yet.
export function formatDateTime(isoText)
{
    if (!isoText)
    {
        return '—';
    }

    return dateTimeFormatter.format(new Date(isoText));
}

// "49 min" or "1 h 5 min" between two ISO times.
export function formatDuration(startIsoText, endIsoText)
{
    const totalMinutes = Math.round((Date.parse(endIsoText) - Date.parse(startIsoText)) / 60000);

    if (totalMinutes < 60)
    {
        return `${totalMinutes} min`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
