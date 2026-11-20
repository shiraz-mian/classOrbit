import { useState } from 'react';
import { Radio, ArrowUpRight, Clock3, Users, CalendarDays } from 'lucide-react';
import { Button, EmptyState } from '../components/ui';
import { dateTime } from '../services/api';
export default function LiveClasses({ data, navigate }) {
  const [filter, setFilter] = useState('upcoming');
  const now = Date.now();
  const classes = data.liveClasses.filter(
    (l) => filter === 'all' || new Date(l.startsAt).getTime() + l.duration * 60000 > now,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LEARNING IS BETTER TOGETHER</span>
          <h1>A classroom without walls.</h1>
          <p>Bring your questions. Meet your people. Find a new perspective.</p>
        </div>
        <span className="live-page-badge">
          <Radio size={18} />
          REAL PEOPLE. REAL TIME.
        </span>
      </div>
      <div className="live-info-banner">
        <span className="live-info-icon">
          <Users size={26} />
        </span>
        <div>
          <h3>A little more human.</h3>
          <p>
            Small-group video classrooms with screen sharing and chat. Up to 8 people, connected.
          </p>
        </div>
        <span>✳</span>
      </div>
      <div className="catalog-toolbar">
        <div className="filter-chips">
          <button
            className={filter === 'upcoming' ? 'selected' : ''}
            onClick={() => setFilter('upcoming')}
          >
            Upcoming classes
          </button>
          <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
            All classes
          </button>
        </div>
        <span className="muted">Times in your local timezone</span>
      </div>
      <div className="live-classes-grid">
        {classes.map((l) => {
          const c = data.courses.find((c) => c.id === l.courseId);
          const dt = new Date(l.startsAt);
          const enrolled =
            data.learning.some((e) => e.courseId === l.courseId) ||
            data.user?.id === c?.instructorId ||
            data.user?.role === 'ADMIN';
          return (
            <article key={l.id} className="live-class-card">
              <div className={'live-class-cover ' + (c?.color || 'coral')}>
                <div className="live-cover-orbits">
                  <i />
                  <i />
                  <i />
                </div>
                <span className="live-cover-label">
                  <Radio size={15} />
                  LIVE WORKSHOP
                </span>
                <span className="live-cover-date">
                  <b>{dt.getDate()}</b>
                  {dt.toLocaleDateString(undefined, { month: 'short' })}
                </span>
              </div>
              <div className="live-class-body">
                <span className="tiny-category">{c?.title}</span>
                <h2>{l.title}</h2>
                <p>with {c?.instructor}</p>
                <div className="live-class-meta">
                  <span>
                    <CalendarDays size={15} />
                    {dateTime(l.startsAt)}
                  </span>
                  <span>
                    <Clock3 size={15} />
                    {l.duration} min
                  </span>
                </div>
                <Button
                  secondary
                  onClick={() => navigate(enrolled ? 'live/' + l.id : 'course/' + l.courseId)}
                >
                  {enrolled ? 'Join classroom' : 'View course to enroll'}
                  <ArrowUpRight size={16} />
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {!classes.length && (
        <EmptyState icon={Radio} title="The next conversation is coming">
          There are no upcoming classes yet. Your instructors can schedule sessions in the Studio.
        </EmptyState>
      )}
    </>
  );
}
