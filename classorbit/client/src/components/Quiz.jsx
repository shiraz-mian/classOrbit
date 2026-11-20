import { useState } from 'react';
import { CheckCircle2, RotateCcw, ArrowRight, Target } from 'lucide-react';
import { Button } from './ui';
import { post } from '../services/api';
export default function Quiz({ quiz, onComplete, notify }) {
  const [answers, setAnswers] = useState({}),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post('/quizzes/' + quiz.id + '/attempts', {
        answers: quiz.questions.map((q, i) => answers[i]),
      });
      setResult(r);
      await onComplete();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="quiz-panel">
      <span className="eyebrow">PUT YOUR KNOWLEDGE TO WORK</span>
      <h2>{quiz.title}</h2>
      <p className="muted">
        {quiz.questions.length} questions · {quiz.passScore}% to pass · You can try again.
      </p>
      {result && (
        <div className={'quiz-result ' + (result.passed ? 'passed' : '')}>
          <Target size={30} />
          <div>
            <h3>
              {result.passed
                ? 'That’s a well-earned milestone.'
                : 'A little practice goes a long way.'}
            </h3>
            <p>
              You scored {result.score}%.{' '}
              {result.passed
                ? 'You passed this knowledge check.'
                : 'Review the feedback and give it another go.'}
            </p>
          </div>
          <Button
            secondary
            onClick={() => {
              setResult(null);
              setAnswers({});
            }}
          >
            <RotateCcw size={16} />
            Try again
          </Button>
        </div>
      )}
      <form onSubmit={submit}>
        {quiz.questions.map((q, i) => (
          <fieldset key={i} className="quiz-question">
            <legend>
              <span>{String(i + 1).padStart(2, '0')}</span>
              {q.prompt}
            </legend>
            {q.options.map((option, j) => (
              <label
                key={j}
                className={
                  (answers[i] === j ? 'chosen ' : '') +
                  (result?.feedback[i].answer === j ? 'correct-option' : '')
                }
              >
                <input
                  type="radio"
                  name={'q' + i}
                  value={j}
                  required
                  checked={answers[i] === j}
                  disabled={!!result}
                  onChange={() => setAnswers({ ...answers, [i]: j })}
                />
                {option}
                {result?.feedback[i].answer === j && <CheckCircle2 size={16} />}
              </label>
            ))}
            {result && <p className="quiz-feedback">{result.feedback[i].explanation}</p>}
          </fieldset>
        ))}
        {!result && (
          <Button
            type="submit"
            disabled={busy || Object.keys(answers).length < quiz.questions.length}
          >
            {busy ? 'Checking your answers…' : 'Check my knowledge'}
            <ArrowRight size={16} />
          </Button>
        )}
      </form>
    </section>
  );
}
