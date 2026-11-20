import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, LockKeyhole } from 'lucide-react';
import { api, post } from './services/api';
import AppLayout from './layouts/AppLayout';
import AuthModal from './components/AuthModal';
import { Button, Loader, EmptyState } from './components/ui';
import Dashboard from './pages/Dashboard';
const Catalog = lazy(() => import('./pages/Catalog'));
const CourseWorkspace = lazy(() => import('./pages/CourseWorkspace'));
const Certificates = lazy(() => import('./pages/Certificates'));
const LiveClasses = lazy(() => import('./pages/LiveClasses'));
const LiveRoom = lazy(() => import('./pages/LiveRoom'));
const Studio = lazy(() => import('./pages/Studio'));
const Revenue = lazy(() => import('./pages/Revenue'));
const Admin = lazy(() => import('./pages/Admin'));
const CheckoutStatus = lazy(() => import('./pages/CheckoutStatus'));
export default function App() {
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [page, setPage] = useState(location.hash.slice(1) || 'dashboard'),
    [search, setSearch] = useState(''),
    [auth, setAuth] = useState(false),
    [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((v) => v.id !== id)), 6500);
  }, []);
  const refresh = useCallback(async () => {
    const result = await api('/bootstrap');
    setData(result);
    return result;
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const handler = () => {
      setPage(location.hash.slice(1) || 'dashboard');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  function navigate(next) {
    if (next === page) {
      window.scrollTo(0, 0);
      return;
    }
    location.hash = next;
  }
  async function logout() {
    try {
      await post('/auth/logout');
      await refresh();
      navigate('dashboard');
      notify('You’re signed out. See you next chapter.');
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  if (error)
    return (
      <div className="boot-error">
        <h1>Let’s reconnect to your workspace.</h1>
        <p>{error}</p>
        <p>Please check your connection and try again in a moment.</p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </div>
    );
  if (!data) return <Loader />;
  const props = {
    data,
    navigate,
    refresh,
    notify,
    onLogin: () => setAuth(true),
    search,
    setSearch,
  };
  let content;
  if (
    ['studio', 'revenue', 'admin'].includes(page) &&
    (!data.user ||
      !['INSTRUCTOR', 'ADMIN'].includes(data.user.role) ||
      (page === 'admin' && data.user.role !== 'ADMIN'))
  )
    content = (
      <EmptyState
        icon={LockKeyhole}
        title="A space for the right role"
        action={<Button onClick={() => setAuth(true)}>Sign in with the right account</Button>}
      >
        This workspace is available to{' '}
        {page === 'admin' ? 'administrators' : 'instructors and administrators'}.
      </EmptyState>
    );
  else if (
    ['studio', 'revenue'].includes(page) &&
    data.user?.role === 'INSTRUCTOR' &&
    !data.user.instructorApproved
  )
    content = (
      <EmptyState
        icon={LockKeyhole}
        title="Your teaching access is awaiting approval"
        action={
          <Button onClick={() => refresh().catch((e) => notify(e.message, 'error'))}>
            Check approval status
          </Button>
        }
      >
        Your instructor account is ready. An admin must approve teaching access before you can
        create courses, upload videos, or host classes. You can explore courses and learn while you
        wait.
      </EmptyState>
    );
  else if (page === 'dashboard') content = <Dashboard {...props} />;
  else if (page === 'catalog' || page === 'learning')
    content = <Catalog key={page} {...props} learningOnly={page === 'learning'} />;
  else if (page === 'certificates') content = <Certificates {...props} />;
  else if (page === 'live') content = <LiveClasses {...props} />;
  else if (page.startsWith('checkout/'))
    content = <CheckoutStatus key={page} {...props} id={decodeURIComponent(page.slice(9))} />;
  else if (page.startsWith('live/'))
    content = <LiveRoom key={page} {...props} id={decodeURIComponent(page.slice(5))} />;
  else if (page.startsWith('course/'))
    content = <CourseWorkspace key={page} {...props} id={decodeURIComponent(page.slice(7))} />;
  else if (page === 'studio') content = <Studio {...props} />;
  else if (page === 'revenue') content = <Revenue {...props} />;
  else if (page === 'admin') content = <Admin {...props} />;
  else
    content = (
      <EmptyState
        title="This page is outside your orbit"
        action={<Button onClick={() => navigate('dashboard')}>Back to overview</Button>}
      >
        Let’s get you back to your learning.
      </EmptyState>
    );
  return (
    <>
      <AppLayout {...props} page={page} onLogout={logout}>
        <Suspense fallback={<Loader />}>{content}</Suspense>
      </AppLayout>
      {auth && <AuthModal mode={data.mode} onClose={() => setAuth(false)} onSuccess={refresh} />}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div className={'toast ' + t.type} key={t.id}>
            {t.type === 'error' ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
            <span>{t.message}</span>
            <button
              className="icon-button"
              onClick={() => setToasts((v) => v.filter((t2) => t2.id !== t.id))}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
