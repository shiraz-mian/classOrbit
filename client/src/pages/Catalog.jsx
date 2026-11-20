import { useState } from 'react';
import { Search, ArrowRight, Compass, BookOpen } from 'lucide-react';
import { CourseCard, EmptyState, Button } from '../components/ui';
export default function Catalog({
  data,
  navigate,
  search,
  setSearch,
  learningOnly = false,
  onLogin,
}) {
  const [category, setCategory] = useState('All courses'),
    [filter, setFilter] = useState('all');
  let courses = data.courses.filter((c) => c.status === 'PUBLISHED');
  if (learningOnly) courses = courses.filter((c) => data.learning.some((e) => e.courseId === c.id));
  const categories = ['All courses', ...new Set(courses.map((c) => c.category))];
  courses = courses.filter(
    (c) =>
      (category === 'All courses' || c.category === category) &&
      (!search ||
        (c.title + ' ' + c.description + ' ' + c.instructor)
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (filter === 'all' || (filter === 'free' && c.price === 0) || c.level === filter),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {learningOnly ? 'YOUR CURIOSITY IN MOTION' : 'FOLLOW YOUR CURIOSITY'}
          </span>
          <h1>{learningOnly ? 'Your learning journey' : 'Find your next “aha.”'}</h1>
          <p>
            {learningOnly
              ? 'Every lesson is a step forward. Keep going.'
              : 'Fresh ideas, practical skills, and a world of possibility.'}
          </p>
        </div>
        <span className="page-counter">
          {courses.length.toString().padStart(2, '0')}
          <small>{learningOnly ? 'enrolled courses' : 'courses to explore'}</small>
        </span>
      </div>
      <div className="catalog-toolbar">
        <div className="filter-chips">
          {categories.map((c) => (
            <button
              className={category === c ? 'selected' : ''}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <select
          aria-label="Filter course level or price"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All levels & prices</option>
          <option value="Beginner">Beginner</option>
          <option value="Intermediate">Intermediate</option>
          <option value="free">Free courses</option>
        </select>
      </div>
      {search && (
        <p className="search-results">
          Results for “{search}”{' '}
          <button className="text-link" onClick={() => setSearch('')}>
            Clear search
          </button>
        </p>
      )}
      {courses.length ? (
        <div className="course-grid catalog-grid">
          {courses.map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              learning={learningOnly ? data.learning.find((e) => e.courseId === c.id) : null}
              onOpen={(id) => navigate('course/' + id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={learningOnly ? BookOpen : Compass}
          title={learningOnly ? 'Your next chapter starts here' : 'No courses found'}
          action={
            <Button
              onClick={() => {
                if (learningOnly && !data.user) onLogin();
                else {
                  setCategory('All courses');
                  setFilter('all');
                  setSearch('');
                  navigate('catalog');
                }
              }}
            >
              {learningOnly && !data.user ? 'Sign in to start' : 'Explore courses'}
              <ArrowRight size={16} />
            </Button>
          }
        >
          {learningOnly
            ? 'Enroll in a course and we’ll keep your learning in one place.'
            : 'Try a different category or search term.'}
        </EmptyState>
      )}
    </>
  );
}
