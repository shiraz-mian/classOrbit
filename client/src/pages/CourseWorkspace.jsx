import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  LockKeyhole,
  BookOpen,
  Clock3,
  Award,
  Play,
  ClipboardCheck,
  ArrowUpRight,
  GraduationCap,
} from 'lucide-react';
import { api, post, money } from '../services/api';
import { Button, CourseArt, ProgressBar, Loader, Modal } from '../components/ui';
import VideoPlayer from '../components/VideoPlayer';
import Quiz from '../components/Quiz';
import { openTestCheckout } from '../services/razorpay';
export default function CourseWorkspace({ id, data, navigate, onLogin, refresh, notify }) {
  const [detail, setDetail] = useState(null),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checkout, setCheckout] = useState(false);
  const checkoutController = useRef(null);
  useEffect(() => () => checkoutController.current?.abort(), []);
  async function load() {
    const result = await api('/courses/' + id);
    setDetail(result);
    return result;
  }
  useEffect(() => {
    let active = true;
    setDetail(null);
    setSelected('');
    setError('');
    api('/courses/' + id)
      .then((d) => {
        if (!active) return;
        setDetail(d);
        setSelected(
          d.lessons.find((l) => !d.progress.some((p) => p.lessonId === l.id))?.id ||
            d.lessons[0]?.id ||
            '',
        );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, data.user?.id]);
  if (error)
    return (
      <div className="error-panel">
        <h2>{error}</h2>
        <Button onClick={() => navigate('catalog')}>Back to courses</Button>
      </div>
    );
  if (!detail) return <Loader />;
  const { course, lessons, quizzes, progress, attempts, access } = detail;
  const meta = data.courses.find((c) => c.id === id) || course;
  const lesson = lessons.find((l) => l.id === selected),
    quiz = quizzes.find((q) => q.id === selected);
  const completeCount = lessons.filter((l) => progress.some((p) => p.lessonId === l.id)).length;
  const percent = lessons.length ? Math.round((completeCount / lessons.length) * 100) : 0;
  const eligible =
    lessons.length > 0 &&
    completeCount === lessons.length &&
    quizzes.every((q) => attempts.some((a) => a.quizId === q.id && a.passed));
  async function enroll() {
    if (!data.user) {
      onLogin();
      return;
    }
    if (course.price > 0) {
      setCheckout(true);
      return;
    }
    setBusy(true);
    try {
      await post('/courses/' + id + '/enroll');
      await Promise.all([load(), refresh()]);
      notify('You’re enrolled. A new chapter begins!');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    setBusy(true);
    let created;
    checkoutController.current = new AbortController();
    try {
      created = await post('/courses/' + id + '/checkout');
      setCheckout(false);
      if (created.orderId) {
        const response = await openTestCheckout(
          created,
          data.user,
          checkoutController.current.signal,
        );
        if (response)
          await post('/payments/verify', { checkoutId: created.checkoutId, ...response });
        else notify('Checkout closed. You can check its status or return to the course.');
        navigate('checkout/' + created.checkoutId);
        return;
      }
      await Promise.all([load(), refresh()]);
      notify(
        created.demo
          ? 'Demo enrollment complete. No real payment was taken.'
          : 'Your enrollment is confirmed.',
      );
    } catch (e) {
      if (e.name === 'AbortError') return;
      notify(e.message, 'error');
      const pending = e.checkoutId || created?.checkoutId;
      if (pending) {
        setCheckout(false);
        navigate('checkout/' + pending);
      }
    } finally {
      setBusy(false);
    }
  }
  async function markComplete() {
    setBusy(true);
    try {
      await post('/lessons/' + lesson.id + '/complete');
      await Promise.all([load(), refresh()]);
      const next = lessons[lessons.findIndex((l) => l.id === selected) + 1];
      if (next) setSelected(next.id);
      else if (quizzes[0]) setSelected(quizzes[0].id);
      notify('One step forward. Lesson completed!');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function claim() {
    setBusy(true);
    try {
      await post('/courses/' + id + '/certificate');
      await refresh();
      navigate('certificates');
      notify('Your certificate is ready. Keep growing!');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="back-link" onClick={() => navigate('catalog')}>
        <ArrowLeft size={16} />
        Back to courses
      </button>
      {!access ? (
        <>
          <div className="course-detail-hero">
            <div>
              <span className="eyebrow">
                {course.category} / {course.level}
              </span>
              <h1>{course.title}</h1>
              <p>{course.description}</p>
              <div className="detail-meta">
                <span>
                  <GraduationCap size={18} />
                  {meta.instructor}
                </span>
                <span>
                  <BookOpen size={17} />
                  {lessons.length} lessons
                </span>
                <span>
                  <Clock3 size={17} />
                  {meta.duration} min
                </span>
              </div>
              <div className="detail-enroll">
                <Button onClick={enroll} disabled={busy}>
                  {course.price ? 'Enroll for ' + money(course.price) : 'Start learning for free'}
                  <ArrowUpRight size={18} />
                </Button>
                <span>
                  <Award size={16} />
                  Certificate on completion
                </span>
              </div>
            </div>
            <CourseArt color={course.color} category={course.category} large />
          </div>
          <div className="course-detail-columns">
            <section className="panel">
              <h2>Your path through the course</h2>
              <p className="muted">Small steps. Practical skills. Lasting confidence.</p>
              <div className="syllabus">
                {lessons.map((l, i) => (
                  <div key={l.id}>
                    <span className="syllabus-number">{String(i + 1).padStart(2, '0')}</span>
                    <span>
                      {l.title}
                      <small>{l.duration} min</small>
                    </span>
                    <LockKeyhole size={16} />
                  </div>
                ))}
              </div>
            </section>
            <aside className="panel course-promise">
              <span>✳</span>
              <h2>
                Learn at your pace.
                <br />
                Grow in good company.
              </h2>
              <p>
                On-demand lessons, live conversations, practical knowledge checks, and a certificate
                to mark your progress.
              </p>
              <p>Lifetime access to your enrolled course, right here in your workspace.</p>
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="workspace-title">
            <div>
              <span className="eyebrow">{course.category} / YOUR COURSE WORKSPACE</span>
              <h1>{course.title}</h1>
              <p>with {meta.instructor}</p>
            </div>
            <span className="workspace-percent">
              {percent}%<small>lessons completed</small>
            </span>
          </div>
          <div className="lesson-workspace">
            <section className="lesson-main">
              {lesson ? (
                <>
                  <VideoPlayer lesson={lesson} />
                  <div className="lesson-content">
                    <span className="eyebrow">
                      LESSON {lesson.position} OF {lessons.length}
                    </span>
                    <h2>{lesson.title}</h2>
                    <div className="lesson-prose">
                      {lesson.content.split('\n\n').map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                    <div className="lesson-actions">
                      <span className="muted">
                        <Clock3 size={15} />
                        {lesson.duration} minute lesson
                      </span>
                      <Button
                        disabled={busy || progress.some((p) => p.lessonId === lesson.id)}
                        onClick={markComplete}
                      >
                        {progress.some((p) => p.lessonId === lesson.id) ? (
                          <>
                            <Check size={16} />
                            Lesson completed
                          </>
                        ) : (
                          <>
                            Mark complete & continue
                            <ArrowRight size={16} />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              ) : quiz ? (
                <Quiz
                  key={quiz.id}
                  quiz={quiz}
                  notify={notify}
                  onComplete={async () => {
                    await Promise.all([load(), refresh()]);
                  }}
                />
              ) : (
                <div className="panel">
                  <h2>Lessons are on their way.</h2>
                  <p>Your instructor is preparing this course.</p>
                </div>
              )}
              {eligible && (
                <div className="completion-banner">
                  <Award size={30} />
                  <div>
                    <h3>You made it. And you made progress.</h3>
                    <p>All lessons complete. Knowledge checks passed.</p>
                  </div>
                  <Button onClick={claim} disabled={busy}>
                    Get your certificate
                    <ArrowUpRight size={16} />
                  </Button>
                </div>
              )}
            </section>
            <aside className="curriculum">
              <div className="curriculum-heading">
                <h3>Your learning path</h3>
                <p>
                  {completeCount} of {lessons.length} lessons completed
                </p>
                <ProgressBar value={percent} />
              </div>
              {lessons.map((l) => {
                const done = progress.some((p) => p.lessonId === l.id);
                return (
                  <button
                    key={l.id}
                    className={'curriculum-item ' + (selected === l.id ? 'selected' : '')}
                    onClick={() => setSelected(l.id)}
                  >
                    <span className={'lesson-indicator ' + (done ? 'done' : '')}>
                      {done ? <Check size={14} /> : l.position}
                    </span>
                    <span>
                      <b>{l.title}</b>
                      <small>
                        {l.duration} min {l.videoStatus === 'READY' ? '· Video' : '· Lesson'}
                      </small>
                    </span>
                    {selected === l.id && <Play size={13} />}
                  </button>
                );
              })}
              {quizzes.map((q) => (
                <button
                  key={q.id}
                  className={'curriculum-item ' + (selected === q.id ? 'selected' : '')}
                  onClick={() => setSelected(q.id)}
                >
                  <span
                    className={
                      'lesson-indicator ' +
                      (attempts.some((a) => a.quizId === q.id && a.passed) ? 'done' : '')
                    }
                  >
                    <ClipboardCheck size={16} />
                  </span>
                  <span>
                    <b>{q.title}</b>
                    <small>
                      {q.questions.length} questions · {q.passScore}% to pass
                    </small>
                  </span>
                </button>
              ))}
              <div className="curriculum-footer">
                <Award size={22} />
                <p>
                  Keep showing up.
                  <br />
                  Your certificate is ahead.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
      {checkout && (
        <Modal
          title={
            data.razorpayConfigured
              ? 'Continue to test checkout'
              : data.mode === 'demo'
                ? 'Complete a demo enrollment'
                : 'Test checkout is not available yet'
          }
          onClose={() => setCheckout(false)}
        >
          <div className="checkout-summary">
            <h3>{course.title}</h3>
            <p>{course.description}</p>
            <div>
              <span>One-time course access</span>
              <b>{money(course.price)}</b>
            </div>
          </div>
          <p className="checkout-notice">
            {data.razorpayConfigured
              ? 'Razorpay test checkout opens in a secure window. Use its test payment options; no real money is charged.'
              : data.mode === 'demo'
                ? 'This is a simulated demo payment. No card details are collected and no money is charged.'
                : 'Paid enrollment will be available after Razorpay test checkout is connected. You can explore free courses in the meantime.'}
          </p>
          <Button
            disabled={busy || (!data.razorpayConfigured && data.mode !== 'demo')}
            onClick={pay}
          >
            {busy
              ? 'One moment…'
              : data.razorpayConfigured
                ? 'Open Razorpay test checkout'
                : data.mode === 'demo'
                  ? 'Confirm simulated payment'
                  : 'Payment setup pending'}
            <ArrowRight size={16} />
          </Button>
        </Modal>
      )}
    </>
  );
}
