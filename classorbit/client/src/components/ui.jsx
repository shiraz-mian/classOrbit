import { useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Clock3,
  X,
  Orbit,
  Check,
  LoaderCircle,
} from 'lucide-react';
import { money } from '../services/api';
export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <Orbit size={27} strokeWidth={1.7} />
      </span>
      Class<span className="logo-light">Orbit</span>
      <span className="logo-dot">.</span>
    </span>
  );
}
export function Avatar({ name = 'Learner', size = 'normal' }) {
  return (
    <span className={'avatar ' + size}>
      {name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function Button({ children, secondary = false, ghost = false, className = '', ...props }) {
  return (
    <button
      className={'button ' + (secondary ? 'secondary ' : ghost ? 'ghost ' : 'primary ') + className}
      {...props}
    >
      {children}
    </button>
  );
}
export function EmptyState({ icon: Icon = BookOpen, title, children, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={30} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Loader() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" />
      Getting things ready…
    </div>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const modalRef = useRef(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selector =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]';
    modalRef.current?.querySelector(selector)?.focus();
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const focusable = [...modalRef.current.querySelectorAll(selector)],
          first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={'modal ' + (wide ? 'wide' : '')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function ProgressBar({ value }) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label="Course progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span style={{ width: value + '%' }} />
    </div>
  );
}
export function CourseArt({ color = 'coral', category = 'Development', large = false }) {
  return (
    <div aria-hidden="true" className={'course-art ' + color + (large ? ' large' : '')}>
      <span className="art-grid" />
      {color === 'coral' ? (
        <div className="code-art">
          <span className="code-top">
            <i />
            <i />
            <i />
          </span>
          <span className="code-line">
            const <b>yourFuture</b> =
          </span>
          <span className="code-line indent">
            &lt;<strong>Possibility</strong>
          </span>
          <span className="code-line indent">
            {' '}
            growth=<em>"infinite"</em>
          </span>
          <span className="code-line indent">/&gt;</span>
          <span className="code-orbit">✳</span>
        </div>
      ) : color === 'lilac' ? (
        <div className="design-art">
          <span className="design-letter">
            Aa<span>✳</span>
          </span>
          <div className="swatches">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className="art-label">FORM / FUNCTION / FEELING</span>
        </div>
      ) : color === 'mint' ? (
        <div className="node-art">
          <span className="node n1">GET</span>
          <span className="node n2">API</span>
          <span className="node n3">
            200 <Check size={13} />
          </span>
          <span className="node-connector" />
          <span className="art-label">A LITTLE LOGIC. ENDLESS POSSIBILITY.</span>
        </div>
      ) : (
        <div className="habit-art">
          <span className="habit-step s1" />
          <span className="habit-step s2" />
          <span className="habit-step s3" />
          <span className="habit-sun">✳</span>
          <span className="art-label">SMALL STEPS. BIG THINGS.</span>
        </div>
      )}
      <span className="art-category">{category}</span>
    </div>
  );
}
export function CourseCard({ course, learning, onOpen }) {
  return (
    <article className="course-card">
      <button
        className="course-cover"
        onClick={() => onOpen(course.id)}
        aria-label={'Open ' + course.title}
      >
        <CourseArt color={course.color} category={course.category} />
        <span className="cover-arrow">
          <ArrowUpRight size={19} />
        </span>
      </button>
      <div className="course-body">
        <div className="course-kicker">
          <span>{course.category}</span>
          <span>{course.level}</span>
        </div>
        <button className="text-button course-title" onClick={() => onOpen(course.id)}>
          {course.title}
        </button>
        <p className="course-instructor">with {course.instructor}</p>
        {learning ? (
          <>
            <div className="progress-caption">
              <span>
                {learning.completed} of {learning.total} lessons
              </span>
              <b>{learning.percent}%</b>
            </div>
            <ProgressBar value={learning.percent} />
            <button className="course-bottom continue-link" onClick={() => onOpen(course.id)}>
              {learning.eligible ? 'Review course' : 'Continue learning'}
              <ArrowRight size={16} />
            </button>
          </>
        ) : (
          <div className="course-bottom">
            <span>
              <BookOpen size={14} />
              {course.lessonCount} lessons <i /> <Clock3 size={14} />
              {course.duration} min
            </span>
            <b>{course.price ? money(course.price) : 'Free'}</b>
          </div>
        )}
      </div>
    </article>
  );
}
export function SectionHeading({ eyebrow, title, action }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
