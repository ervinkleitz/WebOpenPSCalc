import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import BuildEditor from "./pages/BuildEditor";
import ErrorBoundary from "./components/ErrorBoundary";
import StatsPage from "./pages/StatsPage";
import ChangelogPage from "./pages/ChangelogPage";
import { statsApi } from "./api/client";

export default function App() {
  useEffect(() => { statsApi.recordPageView(); }, []);

  return (
    <div className="app-shell">
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<BuildEditor />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}
