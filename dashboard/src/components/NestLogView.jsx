// The "Nest log" page: every nest site on the left, and the selected
// site's details, its own log, and the patrol update form on the right.

import NestList from './NestList.jsx';
import NestDetail from './NestDetail.jsx';
import NestCharts from './NestCharts.jsx';
import ResponseTimes from './ResponseTimes.jsx';

export default function NestLogView(
{
    nestSites,
    zones,
    dataTag,
    generatedAt,
    selectedNestIdentifier,
    onSelectNest,
    onAddPatrolEntry,
    onClearPatrolEntries,
})
{
    const selectedNestSite = nestSites.find(function matchesSelection(nestSite)
    {
        return nestSite.nestIdentifier === selectedNestIdentifier;
    }) ?? null;

    // On narrow screens the details sit below the list, so after picking a
    // site, scroll down to it. Waits a frame so the new details are drawn.
    function selectNestFromList(nestIdentifier)
    {
        onSelectNest(nestIdentifier);

        if (window.matchMedia('(max-width: 1000px)').matches)
        {
            window.requestAnimationFrame(function scrollToDetails()
            {
                document.getElementById('nest-detail-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    }

    return (
        <main className="nest-log">
            <NestCharts nestSites={nestSites} zones={zones} />
            <ResponseTimes nestSites={nestSites} generatedAt={generatedAt} onSelectNest={selectNestFromList} />

            <NestList
                nestSites={nestSites}
                zones={zones}
                dataTag={dataTag}
                selectedNestIdentifier={selectedNestIdentifier}
                onSelectNest={selectNestFromList}
                onClearPatrolEntries={onClearPatrolEntries}
            />

            {selectedNestSite
                ? (
                    <NestDetail
                        key={selectedNestSite.nestIdentifier}
                        nestSite={selectedNestSite}
                        zones={zones}
                        onAddPatrolEntry={onAddPatrolEntry}
                    />
                )
                : (
                    <section className="panel nest-detail">
                        <h2 className="panel__title">Nest site</h2>
                        <p className="panel__empty">Pick a site from the list to see its log and add a patrol update.</p>
                    </section>
                )}
        </main>
    );
}
