import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Award,
  Clock3,
  Check,
  Radio,
  Sparkles,
  Play,
} from 'lucide-react';
import { CourseCard, CourseArt, SectionHeading, ProgressBar, Button } from '../components/ui';
import { dateTime } from '../services/api';
export default function Dashboard({ data, navigate, onLogin }) {
  const ongoing = data.learning.filter((e) => !e.eligible),
    completed = data.learning.filter((e) => e.eligible);
  const minutes = data.learning.reduce(
    (sum, e) =>
      sum +
      Math.round(
        ((data.courses.find((c) => c.id === e.courseId)?.duration || 0) * e.percent) / 100,
      ),
    0,
  );
  const first = data.user?.name.split(' ')[0];
  const nextLive = data.liveClasses
    .filter((l) => new Date(l.startsAt).getTime() + l.duration * 60000 > Date.now())
    .slice(0, 2);
  const courses = data.courses.filter((c) => c.status === 'PUBLISHED');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE ROOM FOR SOMETHING NEW</span>
          <h1>
            {first ? 'Hello, ' + first + '.' : 'Hello, curious mind.'}{' '}
            <span className="greeting-wave">✦</span>
          </h1>
          <p>Your next chapter is waiting. Let’s make it a good one.</p>
        </div>
        <span className="today-label">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-eyebrow">
            <span />
            YOUR LEARNING, IN ORBIT
          </span>
          <h2>
            A little progress.
            <br />
            <em>Every day.</em>
          </h2>
          <p>
            Big ideas begin with small steps. Find your focus,
            <br className="desktop-break" /> follow your curiosity, and keep moving forward.
          </p>
          <div className="hero-actions">
            <Button
              onClick={() =>
                ongoing[0] ? navigate('course/' + ongoing[0].courseId) : navigate('catalog')
              }
            >
              {ongoing[0] ? 'Continue learning' : 'Find your next course'}
              <ArrowUpRight size={18} />
            </Button>
            <span>Make today a learning day.</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <svg viewBox="0 0 420 300">
            <defs>
              <pattern id="hero-dots" width="16" height="16" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#476271" />
              </pattern>
            </defs>
            <rect x="0" y="0" width="420" height="300" fill="url(#hero-dots)" />
            <ellipse
              cx="232"
              cy="150"
              rx="151"
              ry="75"
              transform="rotate(-35 232 150)"
              stroke="#6d858d"
              strokeWidth="1"
              fill="none"
            />
            <ellipse
              cx="232"
              cy="150"
              rx="151"
              ry="75"
              transform="rotate(35 232 150)"
              stroke="#476574"
              strokeWidth="1"
              fill="none"
            />
            <circle cx="230" cy="150" r="88" fill="#f2eee0" />
            <circle cx="230" cy="150" r="71" stroke="#d7d4c8" fill="none" />
            <path d="M173 190L230 81L288 190Z" fill="#fb9579" />
            <path d="M200 190L230 133L261 190Z" fill="#182f40" />
            <path d="M223 205h72v11h-72zM245 188h50v11h-50zM269 171h26v11h-26z" fill="#92b8ae" />
            <circle cx="105" cy="127" r="18" fill="#a2bfb0" />
            <path d="M98 127l5 5 9-10" fill="none" stroke="#182f40" strokeWidth="2.5" />
            <circle cx="351" cy="175" r="12" fill="#c9bde1" />
            <path
              d="M328 55v22M317 66h22M320 58l16 16M320 74l16-16"
              stroke="#f2c17e"
              strokeWidth="2"
            />
            <path d="M97 226v16M89 234h16" stroke="#f2eee0" strokeWidth="2" />
            <circle cx="167" cy="44" r="3" fill="#fc9878" />
            <text x="273" y="266" fill="#adbbc0" fontSize="9" letterSpacing="3">
              STAY CURIOUS.
            </text>
          </svg>
          <span className="hero-float">
            <Sparkles size={14} />A world of possibility
          </span>
        </div>
      </section>
      <div className="stats-grid">
        {[
          [BookOpen, 'Courses in progress', ongoing.length, 'coral'],
          [Check, 'Courses completed', completed.length, 'mint'],
          [Clock3, 'Minutes of progress', minutes, 'lilac'],
          [Award, 'Certificates earned', data.certificates.length, 'sand'],
        ].map(([Icon, label, value, color]) => (
          <div className="stat-card" key={label}>
            <span className={'stat-icon ' + color}>
              <Icon size={21} />
            </span>
            <div>
              <span>{label}</span>
              <b>{value.toString().padStart(2, '0')}</b>
            </div>
            <ArrowUpRight className="stat-corner" size={16} />
          </div>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="learning-section">
          <SectionHeading
            title={ongoing.length ? 'Pick up where you left off' : 'A good place to begin'}
            action={
              <button
                className="text-link"
                onClick={() => navigate(ongoing.length ? 'learning' : 'catalog')}
              >
                View all
                <ArrowRight size={15} />
              </button>
            }
          />
          {ongoing.length ? (
            ongoing.slice(0, 2).map((e) => {
              const c = courses.find((c) => c.id === e.courseId);
              return (
                c && (
                  <article className="continue-card" key={e.id}>
                    <div className="continue-art">
                      <CourseArt color={c.color} category={c.category} />
                    </div>
                    <div className="continue-info">
                      <span className="tiny-category">{c.category}</span>
                      <h3>{c.title}</h3>
                      <p>with {c.instructor}</p>
                      <div className="progress-caption">
                        <span>
                          {e.completed} of {e.total} lessons completed
                        </span>
                        <b>{e.percent}%</b>
                      </div>
                      <ProgressBar value={e.percent} />
                    </div>
                    <button
                      className="round-play"
                      aria-label={'Continue ' + c.title}
                      onClick={() => navigate('course/' + c.id)}
                    >
                      <Play size={18} fill="currentColor" />
                    </button>
                  </article>
                )
              );
            })
          ) : (
            <div className="welcome-card">
              <span className="welcome-asterisk">✳</span>
              <h3>It starts with curiosity.</h3>
              <p>Pick a course that sparks something. We’ll save your place as you go.</p>
              <Button secondary onClick={() => (data.user ? navigate('catalog') : onLogin())}>
                {data.user ? 'Explore the catalog' : 'Start your learning journey'}
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          <SectionHeading
            title="A fresh perspective"
            action={
              <button className="text-link" onClick={() => navigate('catalog')}>
                Explore courses
                <ArrowRight size={15} />
              </button>
            }
          />
          <div className="course-grid dashboard-course-grid">
            {courses
              .filter((c) => !data.learning.some((e) => e.courseId === c.id))
              .slice(0, 2)
              .map((c) => (
                <CourseCard key={c.id} course={c} onOpen={(id) => navigate('course/' + id)} />
              ))}
          </div>
        </section>
        <aside className="dashboard-aside">
          <div className="upcoming-panel">
            <div className="aside-heading">
              <h2>Coming up live</h2>
              <span className="live-dot">
                <i />
                LIVE CLASSES
              </span>
            </div>
            <p className="aside-subtitle">Good questions. Real conversations.</p>
            {nextLive.map((l) => {
              const c = courses.find((c) => c.id === l.courseId);
              const dt = new Date(l.startsAt);
              return (
                <article className="upcoming-card" key={l.id}>
                  <div className={'date-tile ' + (c?.color || 'coral')}>
                    <span>{dt.toLocaleDateString(undefined, { month: 'short' })}</span>
                    <b>{dt.getDate()}</b>
                  </div>
                  <div>
                    <span className="tiny-category">{c?.category}</span>
                    <h3>{l.title}</h3>
                    <p>
                      {dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ·{' '}
                      {l.duration} min
                    </p>
                  </div>
                  <button className="class-join" onClick={() => navigate('live/' + l.id)}>
                    Join classroom
                    <ArrowUpRight size={15} />
                  </button>
                </article>
              );
            })}
            {!nextLive.length && <p>No upcoming classes. Check back soon.</p>}
            <button className="full-text-link" onClick={() => navigate('live')}>
              View class schedule
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="thought-card">
            <span className="thought-symbol">✳</span>
            <span className="eyebrow">A LITTLE REMINDER</span>
            <h3>
              You don’t have to
              <br />
              be great to start.
            </h3>
            <p>
              You just have to start
              <br />
              to get a little better.
            </p>
            <div className="thought-line" />
            <span>Keep your curiosity in motion.</span>
          </div>
        </aside>
      </div>
    </>
  );
}
