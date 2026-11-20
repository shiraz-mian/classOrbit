import { useEffect, useState } from 'react';
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Upload,
  Radio,
  ClipboardCheck,
  Check,
  Settings2,
  ExternalLink,
} from 'lucide-react';
import { Button, Modal, CourseArt, EmptyState } from '../components/ui';
import { api, post, money } from '../services/api';
const emptyCourse = {
  title: '',
  description: '',
  category: 'Development',
  level: 'Beginner',
  price: 0,
  color: 'coral',
};
export default function Studio({ data, refresh, notify, navigate }) {
  const [selected, setSelected] = useState(''),
    [detail, setDetail] = useState(null),
    [modal, setModal] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState(emptyCourse),
    [questions, setQuestions] = useState([
      { prompt: '', options: ['', '', '', ''], correct: 0, explanation: '' },
    ]);
  const courses = data.courses.filter(
    (c) => c.instructorId === data.user.id || data.user.role === 'ADMIN',
  );
  async function load() {
    if (selected) setDetail(await api('/courses/' + selected));
  }
  useEffect(() => {
    setDetail(null);
    if (selected)
      api('/courses/' + selected)
        .then(setDetail)
        .catch((e) => notify(e.message, 'error'));
  }, [selected]);
  useEffect(() => {
    if (!detail?.lessons.some((l) => ['QUEUED', 'PROCESSING'].includes(l.videoStatus))) return;
    const timer = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [detail, selected]);
  async function action(fn, message) {
    setBusy(true);
    try {
      await fn();
      await Promise.all([refresh(), load()]);
      notify(message);
      setModal('');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  function saveCourse(e) {
    e.preventDefault();
    action(
      async () => {
        if (modal === 'settings')
          await api('/studio/courses/' + selected, { method: 'PATCH', body: draft });
        else {
          const c = await post('/studio/courses', draft);
          setSelected(c.id);
        }
      },
      modal === 'settings' ? 'Course details updated.' : 'Your new course is ready to shape.',
    );
  }
  function addLesson(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    action(
      () =>
        post('/studio/courses/' + selected + '/lessons', { ...f, duration: Number(f.duration) }),
      'Lesson added to your curriculum.',
    );
  }
  function addQuiz(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    action(
      () =>
        post('/studio/courses/' + selected + '/quizzes', {
          title: f.get('title'),
          passScore: Number(f.get('passScore')),
          questions,
        }),
      'Knowledge check created.',
    );
  }
  function schedule(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    action(
      () =>
        post('/studio/live-classes', {
          courseId: selected,
          title: f.title,
          startsAt: new Date(f.startsAt).toISOString(),
          duration: Number(f.duration),
        }),
      'Your live class is on the calendar.',
    );
  }
  function updateQuestion(i, key, value) {
    setQuestions((q) => q.map((item, j) => (i === j ? { ...item, [key]: value } : item)));
  }
  async function upload(lesson, file) {
    if (!file) return;
    const form = new FormData();
    form.append('video', file);
    await action(
      () => api('/studio/lessons/' + lesson.id + '/video', { method: 'POST', body: form }),
      'Video queued. The worker will prepare it for streaming.',
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PASS YOUR KNOWLEDGE FORWARD</span>
          <h1>Your instructor studio.</h1>
          <p>A space to create something that makes a difference.</p>
        </div>
        <Button
          onClick={() => {
            setDraft(emptyCourse);
            setModal('course');
          }}
        >
          <Plus size={17} />
          Create a course
        </Button>
      </div>
      {!selected ? (
        <div className="studio-grid">
          {courses.map((c) => (
            <article className="studio-card" key={c.id}>
              <CourseArt color={c.color} category={c.category} />
              <div>
                <span className={'status-badge ' + c.status.toLowerCase()}>
                  {c.status.toLowerCase()}
                </span>
                <h2>{c.title}</h2>
                <p>
                  {c.lessonCount} lessons · {c.price ? money(c.price) : 'Free'} · {c.level}
                </p>
                <button className="text-link" onClick={() => setSelected(c.id)}>
                  Open course studio
                  <ArrowRight size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <>
          <button
            className="back-link"
            onClick={() => {
              setSelected('');
              setDetail(null);
            }}
          >
            <ArrowLeft size={16} />
            All your courses
          </button>
          {detail && (
            <>
              <div className="studio-course-heading">
                <div>
                  <span className={'status-badge ' + detail.course.status.toLowerCase()}>
                    {detail.course.status.toLowerCase()}
                  </span>
                  <h2>{detail.course.title}</h2>
                </div>
                <div className="button-row">
                  <Button
                    secondary
                    onClick={() => {
                      setDraft(
                        Object.fromEntries(
                          Object.keys(emptyCourse).map((k) => [k, detail.course[k]]),
                        ),
                      );
                      setModal('settings');
                    }}
                  >
                    <Settings2 size={16} />
                    Settings
                  </Button>
                  <Button secondary onClick={() => navigate('course/' + selected)}>
                    <ExternalLink size={16} />
                    Preview
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      action(
                        () =>
                          api('/studio/courses/' + selected, {
                            method: 'PATCH',
                            body: {
                              status: detail.course.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
                            },
                          }),
                        detail.course.status === 'PUBLISHED'
                          ? 'Course unpublished.'
                          : 'Your course is published!',
                      )
                    }
                  >
                    {detail.course.status === 'PUBLISHED' ? 'Unpublish' : 'Publish course'}
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </div>
              <div className="studio-editor-grid">
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>Build the learning path</h2>
                      <p className="muted">Make every lesson a small step forward.</p>
                    </div>
                    <Button secondary onClick={() => setModal('lesson')}>
                      <Plus size={16} />
                      Add lesson
                    </Button>
                  </div>
                  {detail.lessons.map((l) => (
                    <div className="studio-lesson" key={l.id}>
                      <span className="lesson-indicator">{l.position}</span>
                      <div>
                        <h3>{l.title}</h3>
                        <p>
                          {l.duration} min ·{' '}
                          <span className={'video-state ' + l.videoStatus.toLowerCase()}>
                            {l.videoStatus === 'EMPTY'
                              ? 'No uploaded video'
                              : l.videoStatus.toLowerCase()}
                          </span>
                        </p>
                      </div>
                      <label
                        className={'button secondary upload-button ' + (busy ? 'disabled' : '')}
                      >
                        <Upload size={15} />
                        Upload video
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime"
                          disabled={busy}
                          onChange={(e) => {
                            upload(l, e.target.files[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  ))}
                  {!detail.lessons.length && (
                    <EmptyState title="The first lesson is a good place to start">
                      Add lesson text, then upload a video when you’re ready.
                    </EmptyState>
                  )}
                  <p className="studio-hint">
                    MP4, MOV, or WebM · Up to 500 MB · Converted to HLS by the FFmpeg worker.
                    {data.mode === 'demo' ? ' Video upload requires the Docker services.' : ''}
                  </p>
                </section>
                <aside>
                  <section className="panel studio-action-panel">
                    <ClipboardCheck size={25} />
                    <h3>A moment to put it into practice.</h3>
                    <p>
                      Add an auto-graded knowledge check. Students must pass every check to earn a
                      certificate.
                    </p>
                    {detail.quizzes.map((q) => (
                      <div className="existing-quiz" key={q.id}>
                        <Check size={14} />
                        {q.title}
                        <small>{q.questions.length} questions</small>
                      </div>
                    ))}
                    <Button
                      secondary
                      onClick={() => {
                        setQuestions([
                          { prompt: '', options: ['', '', '', ''], correct: 0, explanation: '' },
                        ]);
                        setModal('quiz');
                      }}
                    >
                      <Plus size={16} />
                      Add knowledge check
                    </Button>
                  </section>
                  <section className="panel studio-action-panel">
                    <Radio size={25} />
                    <h3>Bring your course to life.</h3>
                    <p>Schedule a small-group conversation with video, screen sharing, and chat.</p>
                    <Button secondary onClick={() => setModal('live')}>
                      <Plus size={16} />
                      Schedule a live class
                    </Button>
                  </section>
                </aside>
              </div>
            </>
          )}
        </>
      )}
      {(modal === 'course' || modal === 'settings') && (
        <Modal
          title={modal === 'course' ? 'Create something worth sharing' : 'Course settings'}
          onClose={() => setModal('')}
        >
          <form className="form-stack" onSubmit={saveCourse}>
            <label>
              Course title
              <input
                required
                minLength={5}
                maxLength={120}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="What will you help people learn?"
              />
            </label>
            <label>
              Description
              <textarea
                required
                minLength={20}
                maxLength={3000}
                rows={4}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <div className="form-row">
              <label>
                Category
                <select
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                >
                  {['Development', 'Design', 'Personal growth', 'Business', 'Data science'].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Level
                <select
                  value={draft.level}
                  onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                >
                  {['Beginner', 'Intermediate', 'Advanced', 'All levels'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Price in INR
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={draft.price / 100}
                  onChange={(e) =>
                    setDraft({ ...draft, price: Math.round(Number(e.target.value) * 100) })
                  }
                />
              </label>
              <label>
                Cover palette
                <select
                  value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                >
                  {['coral', 'mint', 'lilac', 'sand'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <Button disabled={busy}>
              {busy ? 'Saving…' : modal === 'course' ? 'Create draft course' : 'Save changes'}
              <ArrowRight size={16} />
            </Button>
          </form>
        </Modal>
      )}
      {modal === 'lesson' && (
        <Modal title="Add a new lesson" onClose={() => setModal('')}>
          <form className="form-stack" onSubmit={addLesson}>
            <label>
              Lesson title
              <input name="title" required minLength={3} maxLength={120} />
            </label>
            <label>
              Lesson content
              <textarea
                name="content"
                rows={8}
                maxLength={20000}
                placeholder="Share an idea. Add an example. Give learners something to try."
              />
            </label>
            <label>
              Estimated duration (minutes)
              <input type="number" name="duration" min="1" max="600" defaultValue="10" required />
            </label>
            <Button disabled={busy}>
              Add lesson
              <Plus size={16} />
            </Button>
          </form>
        </Modal>
      )}
      {modal === 'quiz' && (
        <Modal title="Build a knowledge check" onClose={() => setModal('')} wide>
          <form onSubmit={addQuiz} className="form-stack">
            <div className="form-row">
              <label>
                Title
                <input
                  name="title"
                  minLength={3}
                  maxLength={100}
                  defaultValue="Knowledge check"
                  required
                />
              </label>
              <label>
                Pass score (%)
                <input
                  name="passScore"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="70"
                  required
                />
              </label>
            </div>
            {questions.map((q, i) => (
              <fieldset className="question-editor" key={i}>
                <legend>Question {i + 1}</legend>
                <label>
                  Question
                  <input
                    required
                    minLength={5}
                    maxLength={500}
                    value={q.prompt}
                    onChange={(e) => updateQuestion(i, 'prompt', e.target.value)}
                  />
                </label>
                <div className="form-row">
                  {q.options.map((o, j) => (
                    <label key={j}>
                      Option {j + 1}
                      <input
                        required
                        maxLength={300}
                        value={o}
                        onChange={(e) =>
                          updateQuestion(
                            i,
                            'options',
                            q.options.map((v, k) => (k === j ? e.target.value : v)),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Correct answer
                  <select
                    value={q.correct}
                    onChange={(e) => updateQuestion(i, 'correct', Number(e.target.value))}
                  >
                    {q.options.map((o, j) => (
                      <option key={j} value={j}>
                        Option {j + 1}
                        {o ? ' — ' + o : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Explanation
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={q.explanation}
                    onChange={(e) => updateQuestion(i, 'explanation', e.target.value)}
                  />
                </label>
              </fieldset>
            ))}
            <div className="button-row">
              <Button
                secondary
                type="button"
                disabled={questions.length >= 10}
                onClick={() =>
                  setQuestions([
                    ...questions,
                    { prompt: '', options: ['', '', '', ''], correct: 0, explanation: '' },
                  ])
                }
              >
                <Plus size={16} />
                Another question
              </Button>
              <Button disabled={busy}>
                Save knowledge check
                <Check size={16} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'live' && (
        <Modal title="Make room for a conversation" onClose={() => setModal('')}>
          <form onSubmit={schedule} className="form-stack">
            <label>
              Class title
              <input
                name="title"
                required
                minLength={5}
                maxLength={120}
                placeholder="A topic worth talking about"
              />
            </label>
            <label>
              Date & time (your timezone)
              <input
                name="startsAt"
                type="datetime-local"
                required
                min={new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)}
              />
            </label>
            <label>
              Duration (minutes)
              <input
                name="duration"
                type="number"
                min="15"
                max="180"
                step="15"
                defaultValue="60"
                required
              />
            </label>
            <Button disabled={busy}>
              Schedule class
              <Radio size={16} />
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
