// Catches a rendering error in one part of the page so the rest keeps
// working (React otherwise blanks the whole app). Shows a short message
// with a way to retry, and logs the error for whoever is debugging.

import { Component } from 'react';

export default class ErrorBoundary extends Component
{
    constructor(props)
    {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error)
    {
        return { error };
    }

    componentDidCatch(error, information)
    {
        console.error(`[${this.props.name}] failed to render`, error, information.componentStack);
    }

    render()
    {
        if (this.state.error)
        {
            return (
                <section className="panel" role="alert">
                    <h2 className="panel__title">{this.props.name} couldn't be shown</h2>
                    <p className="panel__empty">Something went wrong drawing this part of the page. The rest of the dashboard is still live.</p>
                    <button
                        type="button"
                        className="primary-button"
                        onClick={() => this.setState({ error: null })}
                    >
                        Try again
                    </button>
                </section>
            );
        }

        return this.props.children;
    }
}
