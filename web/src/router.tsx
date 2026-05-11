import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/Layout";
import { LoginPage } from "@/pages/Login";
import { TripsPage } from "@/pages/admin/Trips";
import { TripDetailPage } from "@/pages/admin/TripDetail";
import { UsersPage } from "@/pages/admin/Users";
import { SharePasswordPage } from "@/pages/public/SharePassword";
import { SharedTripPage } from "@/pages/public/SharedTrip";
import { SinglePhotoPage } from "@/pages/public/SinglePhoto";
import { UploadPage } from "@/pages/public/Upload";
import { SettingsPage } from "@/pages/admin/Settings";
import { TripPreviewPage } from "@/pages/admin/TripPreview";

function RequireAuth({
  children,
  role,
}: {
  children: React.ReactNode;
  role?: "admin" | "editor";
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="p-8 text-zinc-500">加载中…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (role && user.role !== role) {
    return <div className="p-8 text-rose-600">权限不足</div>;
  }
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Public shared-album routes (no admin layout) */}
      <Route path="/s/:code" element={<SharePasswordPage />} />
      <Route path="/s/:code/view" element={<SharedTripPage />} />
      <Route path="/a/:code" element={<SinglePhotoPage />} />
      <Route path="/upload/:code" element={<UploadPage />} />

      <Route element={<AppLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={<Navigate to="/admin" replace />}
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <TripsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/trips/:id"
          element={
            <RequireAuth>
              <TripDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/trips/:id/preview"
          element={
            <RequireAuth>
              <TripPreviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAuth role="admin">
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <RequireAuth role="admin">
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<div className="p-8">404</div>} />
      </Route>
    </Routes>
  );
}
