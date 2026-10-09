// The form patrol members use to add an entry to a nest site's log, for
// example "Patrol visited" or "Protection set up". Entries are only ever
// added, never edited, so the log keeps a full history.

import { useState } from 'react';
import { nestEventTypes, patrolActionOrder } from '../config/nestEvents.js';

// The patrol member's name is remembered in this browser so they don't
// retype it on every update.
const patrolNameStorageKey = 'nesttrace.patrolName';

function readSavedPatrolName()
{
    try
    {
        return window.localStorage.getItem(patrolNameStorageKey) ?? '';
    }
    catch
    {
        return '';
    }
}

function savePatrolName(patrolName)
{
    try
    {
        window.localStorage.setItem(patrolNameStorageKey, patrolName);
    }
    catch
    {
        // Storage is blocked: the name just won't be remembered.
    }
}

export default function PatrolUpdateForm({ nestIdentifier, protectionStatus, onAddPatrolEntry })
{
    const [patrolName, setPatrolName] = useState(readSavedPatrolName);

    // Suggest the most likely next step: a visit first, then protection.
    const [actionType, setActionType] = useState(protectionStatus === 'unprotected' ? 'patrolVisit' : 'note');
    const [note, setNote] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [confirmationMessage, setConfirmationMessage] = useState('');

    function handleSubmit(submitEvent)
    {
        submitEvent.preventDefault();

        const trimmedName = patrolName.trim();
        const trimmedNote = note.trim();

        if (trimmedName === '')
        {
            setErrorMessage('Enter your name so the log shows who made this update.');
            return;
        }

        if (actionType === 'note' && trimmedNote === '')
        {
            setErrorMessage('Write the note before adding it.');
            return;
        }

        onAddPatrolEntry(nestIdentifier, { type: actionType, author: trimmedName, note: trimmedNote });
        savePatrolName(trimmedName);

        setNote('');
        setErrorMessage('');
        setConfirmationMessage(`Added "${nestEventTypes[actionType].label}" to ${nestIdentifier}'s log.`);
    }

    function clearMessages()
    {
        setErrorMessage('');
        setConfirmationMessage('');
    }

    return (
        <form className="patrol-form" onSubmit={handleSubmit} noValidate>
            <h3 className="nest-detail__subtitle">Patrol update</h3>

            <div className="patrol-form__fields">
                <label className="patrol-form__field">
                    <span className="fact__label">Your name</span>
                    <input
                        type="text"
                        value={patrolName}
                        placeholder="J. Alvarez"
                        autoComplete="name"
                        onChange={function handleNameChange(changeEvent)
                        {
                            setPatrolName(changeEvent.target.value);
                            clearMessages();
                        }}
                    />
                </label>

                <label className="patrol-form__field">
                    <span className="fact__label">What happened</span>
                    <select
                        value={actionType}
                        onChange={function handleActionChange(changeEvent)
                        {
                            setActionType(changeEvent.target.value);
                            clearMessages();
                        }}
                    >
                        {patrolActionOrder.map(function renderActionOption(type)
                        {
                            return <option key={type} value={type}>{nestEventTypes[type].label}</option>;
                        })}
                    </select>
                </label>
            </div>

            <label className="patrol-form__field">
                <span className="fact__label">Note {actionType === 'note' ? '' : '(optional)'}</span>
                <textarea
                    rows={2}
                    value={note}
                    placeholder={actionType === 'protectionInstalled' ? 'Stakes and flagging tape, 3 m perimeter' : 'What you saw at the site'}
                    onChange={function handleNoteChange(changeEvent)
                    {
                        setNote(changeEvent.target.value);
                        clearMessages();
                    }}
                />
            </label>

            {actionType === 'protectionInstalled' && protectionStatus === 'unprotected' && (
                <p className="patrol-form__hint">This clears the site's Unprotected flag.</p>
            )}

            {errorMessage && <p className="patrol-form__error" role="alert">{errorMessage}</p>}
            {confirmationMessage && <p className="patrol-form__confirmation" role="status">{confirmationMessage}</p>}

            <button type="submit" className="primary-button">Add to log</button>
        </form>
    );
}
