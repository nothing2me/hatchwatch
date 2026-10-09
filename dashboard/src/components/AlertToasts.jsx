// Live alerts in the corner of the screen, one per new nest site. Opening an
// alert jumps to that site's log; they also expire on their own (App.jsx).

import { formatDateTime } from '../utils/formatTime.js';

export default function AlertToasts({ alerts, onOpen, onDismiss })
{
    return (
        <div className="alert-toasts" role="status" aria-live="polite">
            {alerts.map(function renderAlert(alert)
            {
                const isSingleCamera = alert.evidenceTier === 'single_camera';

                return (
                    <div key={alert.nestIdentifier} className={isSingleCamera ? 'alert-toast alert-toast--review' : 'alert-toast'}>
                        <button
                            type="button"
                            className="alert-toast__body"
                            onClick={function handleOpen()
                            {
                                onOpen(alert.nestIdentifier);
                                onDismiss(alert.nestIdentifier);
                            }}
                        >
                            <span className="alert-toast__title">{alert.text}</span>
                            <span className="alert-toast__meta">
                                {alert.nestIdentifier} · Zone {alert.zoneIdentifier}, {alert.zoneName} · {formatDateTime(alert.alertRaisedAt)}
                            </span>
                            <span className="alert-toast__meta">
                                {isSingleCamera
                                    ? `Seen by ${alert.seenByCameras[0]} only: needs review`
                                    : `Seen by ${alert.seenByCameras.join(' and ')}`}
                            </span>
                        </button>
                        <button
                            type="button"
                            className="alert-toast__close"
                            aria-label={`Dismiss alert for ${alert.nestIdentifier}`}
                            onClick={function handleDismiss()
                            {
                                onDismiss(alert.nestIdentifier);
                            }}
                        >
                            ×
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
