import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { AppRoutes } from "@/router";
import { Toaster } from "@/components/Toaster";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
