import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Pricing from "./pages/Pricing";
import PaymentHistory from "./pages/PaymentHistory";
import AdminDashboard from "./pages/AdminDashboard";
import SubscriptionManagement from "./pages/SubscriptionManagement";
import Profile from "./pages/Profile";
import Contact from "./pages/Contact";

/**
 * Auth guard component - redirects to home if not authenticated
 */
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

/**
 * Admin guard - requires admin role
 */
function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }

  if (user?.role !== "admin") {
    return <Redirect to="/chat" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path={"/"} component={Home} />
      <Route path={"/pricing"} component={Pricing} />
      <Route path={"/contact"} component={Contact} />

      {/* Protected routes - require authentication */}
      <Route path={"/chat"}>
        <ProtectedRoute component={Chat} />
      </Route>
      <Route path={"/chat/:conversationId"}>
        <ProtectedRoute component={Chat} />
      </Route>
      <Route path={"/payments"}>
        <ProtectedRoute component={PaymentHistory} />
      </Route>
      <Route path={"/subscription"}>
        <ProtectedRoute component={SubscriptionManagement} />
      </Route>
      <Route path={"/profile"}>
        <ProtectedRoute component={Profile} />
      </Route>

      {/* Admin routes - require admin role */}
      <Route path={"/admin"}>
        <AdminRoute component={AdminDashboard} />
      </Route>

      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
