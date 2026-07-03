import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import BuildEditor from "./pages/BuildEditor";
import StatsPage from "./pages/StatsPage";
import { statsApi } from "./api/client";

export default function App() {
  useEffect(() => { statsApi.recordPageView(); }, []);

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<BuildEditor />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
