import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Terjadi kesalahan pada tampilan aplikasi.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#08090c] text-[#f3f5f8] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#11141c] border border-[#2d3548] rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-bold text-white">Studio mengalami gangguan tak terduga</h1>
            <p className="text-sm text-[#8f98a8] break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
              }}
              className="px-4 py-2 rounded-lg bg-[#ff5436] hover:bg-[#ff6b52] text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              Pulihkan Studio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
