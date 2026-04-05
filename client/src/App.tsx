import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";

// Lazy load all pages for better bundle splitting
const Home = lazy(() => import("./pages/Home"));
const Chat = lazy(() => import("./pages/Chat"));
const Pricing = lazy(() => import("./pages/Pricing"));
const PaymentHistory = lazy(() => import("./pages/PaymentHistory"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const SubscriptionManagement = lazy(() => import("./pages/SubscriptionManagement"));
const Profile = lazy(() => import("./pages/Profile"));
const Contact = lazy(() => import("./pages/Contact"));
const Login = lazy(() => import("./pages/Login"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    </div>
  );
}

/**
 * Auth guard component - redirects to home if not authenticated
 */
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  // Testează automat dacă perioada de abonament este depășită (valabil la cei cu plan)
  if (user && (user.subscriptionStatus === "cancelled" || user.subscriptionStatus === "past_due")) {
    const isPricingPage = window.location.pathname === "/pricing";
    if (!isPricingPage) {
      return <Redirect to="/pricing" />;
    }
  }

  return <Component />;
}

/**
 * Admin guard - requires admin role
 */
function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (user?.role !== "admin") return <Redirect to="/chat" />;
  return <Component />;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes */}
        <Route path={"/"} component={Home} />
        <Route path={"/pricing"} component={Pricing} />
        <Route path={"/contact"} component={Contact} />
        <Route path={"/login"} component={Login} />

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
    </Suspense>
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
