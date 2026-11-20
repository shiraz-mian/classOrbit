import { useState } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  Compass,
  Radio,
  Award,
  Presentation,
  Users,
  Search,
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  X,
  ArrowUpRight,
  LifeBuoy,
} from 'lucide-react';
import { Logo, Avatar, Button, Modal } from '../components/ui';
import { dateTime } from '../services/api';
const links = [
  ['dashboard', 'Overview', LayoutDashboard],
  ['learning', 'My learning', BookOpen],
  ['catalog', 'Explore courses', Compass],
  ['live', 'Live classes', Radio],
  ['certificates', 'Certificates', Award],
];
export default function AppLayout({
  data,
  page,
  navigate,
  search,
  setSearch,
  onLogin,
  onLogout,
  children,
}) {
  const [mobile, setMobile] = useState(false),
    [notifications, setNotifications] = useState(false),
    [profile, setProfile] = useState(false),
    [help, setHelp] = useState(false);
  const user = data.user;
  const current =
    [
      ...links,
      ['studio', 'Instructor studio'],
      ['revenue', 'Earnings'],
      ['admin', 'People & roles'],
    ].find((l) => l[0] === page)?.[1] ||
    (page.startsWith('course/')
      ? 'Course workspace'
      : page.startsWith('checkout/')
        ? 'Test payment'
        : 'Live classroom');
  const nav = (p) => {
    navigate(p);
    setMobile(false);
  };
  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobile ? 'open' : '')}>
        <div className="sidebar-brand">
          <button
            className="text-button"
            onClick={() => nav('dashboard')}
            aria-label="ClassOrbit home"
          >
            <Logo />
          </button>
          <button
            className="icon-button mobile-close"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
        </div>
        <span className="sidebar-label">YOUR WORKSPACE</span>
        <nav>
          {links.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => nav(key)}
              className={'nav-link ' + (page === key ? 'active' : '')}
            >
              <Icon size={20} />
              <span>{label}</span>
              {key === 'live' &&
                data.liveClasses.some((l) => new Date(l.startsAt) > new Date()) && (
                  <span className="nav-indicator" />
                )}
            </button>
          ))}
        </nav>
        {['INSTRUCTOR', 'ADMIN'].includes(user?.role) && (
          <>
            <span className="sidebar-label teaching-label">TEACH & INSPIRE</span>
            <nav>
              <button
                className={'nav-link ' + (page === 'studio' ? 'active' : '')}
                onClick={() => nav('studio')}
              >
                <Presentation size={20} />
                Instructor studio
              </button>
              <button
                className={'nav-link ' + (page === 'revenue' ? 'active' : '')}
                onClick={() => nav('revenue')}
              >
                <span className="dollar-icon">$</span>Earnings
              </button>
              {user?.role === 'ADMIN' && (
                <button
                  className={'nav-link ' + (page === 'admin' ? 'active' : '')}
                  onClick={() => nav('admin')}
                >
                  <Users size={20} />
                  People & roles
                </button>
              )}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-art">
              <LifeBuoy size={29} />
              <span>✦</span>
            </span>
            <h3>A little guidance?</h3>
            <p>Let’s make learning feel simple.</p>
            <button onClick={() => setHelp(true)}>
              Visit the help desk
              <ArrowUpRight size={16} />
            </button>
          </div>
          <span className="sidebar-caption">A WORLD OF POSSIBILITY.</span>
          <div className="sidebar-foot">
            ClassOrbit © 2026<span>✳</span>
          </div>
        </div>
      </aside>
      {mobile && <div className="nav-scrim" onClick={() => setMobile(false)} />}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span> <b>{current}</b>
            </span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Search courses"
                placeholder="Search anything…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  navigate('catalog');
                }}
              />
              <kbd>⌕</kbd>
            </label>
            <div className="popover-wrap">
              <button
                className="icon-button notification-button"
                aria-label="Class notifications"
                onClick={() => {
                  setNotifications(!notifications);
                  setProfile(false);
                }}
              >
                <Bell size={20} />
                {data.liveClasses.length > 0 && <i />}
              </button>
              {notifications && (
                <div className="popover notifications">
                  <h3>On your radar</h3>
                  {data.liveClasses.slice(0, 3).map((l) => (
                    <button
                      key={l.id}
                      onClick={() => {
                        navigate('live/' + l.id);
                        setNotifications(false);
                      }}
                    >
                      <Radio size={18} />
                      <span>
                        <b>{l.title}</b>
                        <small>{dateTime(l.startsAt)}</small>
                      </span>
                    </button>
                  ))}
                  {!data.liveClasses.length && <p>No scheduled classes yet.</p>}
                </div>
              )}
            </div>
            <span className="header-divider" />
            {user ? (
              <div className="popover-wrap">
                <button
                  className="profile-button"
                  onClick={() => {
                    setProfile(!profile);
                    setNotifications(false);
                  }}
                  aria-label="Account menu"
                >
                  <Avatar name={user.name} />
                  <span>
                    <b>{user.name}</b>
                    <small>{user.role.toLowerCase()}</small>
                  </span>
                  <ChevronDown size={15} />
                </button>
                {profile && (
                  <div className="popover profile-popover">
                    <p>{user.email}</p>
                    <button
                      onClick={() => {
                        setProfile(false);
                        onLogout();
                      }}
                    >
                      <LogOut size={17} />
                      Sign out
                    </button>
                    {data.mode === 'demo' && (
                      <button
                        onClick={() => {
                          setProfile(false);
                          onLogin();
                        }}
                      >
                        Switch demo account
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={onLogin}>
                Get started
                <ArrowUpRight size={16} />
              </Button>
            )}
          </div>
        </header>
        {data.mode === 'demo' && (
          <div className="demo-banner">
            <span>
              <i /> LOCAL DEMO <span className="demo-separator">/</span> Sample content. Payments
              are simulated unless Razorpay test keys are configured.
            </span>
            <button onClick={onLogin}>
              {user ? 'Switch account' : 'Try a demo account'}
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {user?.role === 'INSTRUCTOR' && !user.instructorApproved && (
          <div className="approval-banner" role="status">
            <span>
              <b>Teaching approval pending.</b> You can sign in and learn. Course creation and video
              upload unlock after admin approval.
            </span>
            <button onClick={() => nav('studio')}>View status</button>
          </div>
        )}
        <main className="page-content">{children}</main>
        <footer className="main-footer">
          <span>A little progress, every day.</span>
          <span>
            Made for curious minds <span className="footer-star">✳</span>
          </span>
        </footer>
      </div>
      {help && (
        <Modal title="A little guidance" onClose={() => setHelp(false)}>
          <div className="help-content">
            <h3>1. Find your next course</h3>
            <p>
              Explore courses and enroll. Free courses open immediately; paid courses use a clearly
              labeled demo payment or Razorpay test checkout.
            </p>
            <h3>2. Make steady progress</h3>
            <p>
              Read each lesson, mark it complete, then pass the knowledge check. Your progress is
              saved to your account.
            </p>
            <h3>3. Learn together</h3>
            <p>
              Join a live class for camera, microphone, screen sharing, and chat. Allow browser
              permissions when prompted.
            </p>
            <h3>4. Celebrate the milestone</h3>
            <p>Complete every lesson and pass all quizzes to unlock your PDF certificate.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
