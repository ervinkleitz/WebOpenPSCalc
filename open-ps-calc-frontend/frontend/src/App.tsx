import { Link, Routes, Route, Navigate } from "react-router-dom";
import BuildEditor from "./pages/BuildEditor";

function Topbar() {
  return (
    <div className="topbar">
      <Link to="/" className="brand">
        <span className="mark">⚔</span>
        <span className="title">Open PS Calc</span>
        <span className="subtitle">pre-renewal damage engine</span>
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <Topbar />
      <Routes>
        <Route path="/" element={<BuildEditor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
