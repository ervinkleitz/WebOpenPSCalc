import { Routes, Route, Navigate } from "react-router-dom";
import BuildEditor from "./pages/BuildEditor";

// BuildEditor is the only page, and it owns the full sticky top bar itself
// (brand + build name + actions) -- a separate app-level topbar above it
// would just be a second header eating vertical space for no reason.
export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<BuildEditor />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
