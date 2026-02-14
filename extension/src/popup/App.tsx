import { HashRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <HashRouter>
      <div className="w-[400px] h-[600px] bg-doom-bg text-white flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-doom-border">
          <h1 className="text-lg font-bold font-mono neon-text-green">
            DoomScroller
          </h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4">
          <Routes>
            <Route
              path="/"
              element={
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <p className="text-6xl">💀</p>
                  <p className="text-doom-muted font-mono text-sm">
                    Setting up...
                  </p>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default App;
