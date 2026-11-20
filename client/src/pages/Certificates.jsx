import { useState } from 'react';
import { Award, ArrowRight, Download, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { Button, EmptyState } from '../components/ui';
import { post } from '../services/api';
export default function Certificates({ data, navigate, refresh, notify }) {
  const [busy, setBusy] = useState('');
  const eligible = data.learning.filter(
    (e) => e.eligible && !data.certificates.some((c) => c.courseId === e.courseId),
  );
  async function claim(id) {
    setBusy(id);
    try {
      await post('/courses/' + id + '/certificate');
      await refresh();
      notify('A milestone worth celebrating. Your certificate is ready!');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROOF OF YOUR PROGRESS</span>
          <h1>Milestones, made official.</h1>
          <p>A little dedication. A well-earned achievement.</p>
        </div>
        <span className="certificate-heading-icon">
          <Award size={40} />
        </span>
      </div>
      {eligible.map((e) => (
        <div className="claim-banner" key={e.courseId}>
          <Award />
          <div>
            <h3>You’ve earned a certificate!</h3>
            <p>{data.courses.find((c) => c.id === e.courseId)?.title}</p>
          </div>
          <Button disabled={busy === e.courseId} onClick={() => claim(e.courseId)}>
            Claim certificate
            <ArrowUpRight size={16} />
          </Button>
        </div>
      ))}
      {data.certificates.length ? (
        <div className="certificate-grid">
          {data.certificates.map((c) => (
            <article className="certificate-card" key={c.id}>
              <div className="certificate-preview">
                <span className="cert-wordmark">
                  ClassOrbit<span>✳</span>
                </span>
                <span className="cert-small">CERTIFICATE OF COMPLETION</span>
                <span className="cert-name">{data.user?.name}</span>
                <span className="cert-course">
                  {data.courses.find((course) => course.id === c.courseId)?.title}
                </span>
                <Award className="cert-seal" size={35} />
                <span className="cert-bottom">A COMMITMENT TO KEEP GROWING.</span>
              </div>
              <div className="certificate-details">
                <span className="verified-label">
                  <CheckCircle2 size={14} />
                  Completed & verified
                </span>
                <h3>{data.courses.find((course) => course.id === c.courseId)?.title}</h3>
                <p>
                  Issued{' '}
                  {new Date(c.issuedAt).toLocaleDateString(undefined, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
                <div className="certificate-actions">
                  <a
                    className="button secondary"
                    href={'/api/certificates/' + c.id + '/pdf'}
                    download
                  >
                    <Download size={16} />
                    Download PDF
                  </a>
                  <a
                    className="icon-button"
                    title="Verify certificate"
                    href={'/api/certificates/' + c.id + '/verify'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ArrowUpRight size={18} />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Award}
          title="Your first milestone is ahead"
          action={
            <Button onClick={() => navigate('learning')}>
              Continue learning
              <ArrowRight size={16} />
            </Button>
          }
        >
          Complete every lesson and pass the course quizzes to unlock a certificate you can download
          and share.
        </EmptyState>
      )}
    </>
  );
}
