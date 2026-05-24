create extension if not exists vector;

create table courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  topic text not null,
  goals text,
  mode text not null check (mode in ('ai_teacher', 'source_grounded')),
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed', 'archived')),
  style_anchor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table course_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'failed')),
  progress int not null default 0 check (progress between 0 and 100),
  current_step text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  filename text not null,
  content_type text,
  storage_path text,
  checksum text,
  processing_state text not null default 'pending' check (processing_state in ('pending', 'processed', 'failed', 'unsupported')),
  error text,
  created_at timestamptz not null default now()
);

create table source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete cascade not null,
  course_id uuid references courses(id) on delete cascade not null,
  chunk_index int not null,
  heading text,
  content text not null,
  summary text,
  checksum text not null,
  token_estimate int,
  created_at timestamptz not null default now(),
  unique(source_id, chunk_index)
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  branch_key text not null,
  title text not null,
  description text not null default '',
  position int not null,
  state text not null default 'not_started' check (state in ('not_started', 'in_progress', 'mastered')),
  active_topic_id uuid,
  topic_count int not null default 0,
  mastered_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, branch_key)
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  branch_id uuid references branches(id) on delete cascade not null,
  parent_id uuid references topics(id) on delete set null,
  topic_key text not null,
  section text not null default 'Core',
  title text not null,
  description text,
  position int not null,
  state text not null default 'locked'
    check (state in ('locked', 'active', 'done', 'unstable', 'partial', 'functional', 'mastered')),
  understanding_level int check (understanding_level between 1 and 5),
  depth text check (depth in ('light', 'medium', 'important', 'critical')),
  estimated_pages int check (estimated_pages > 0),
  total_pages_planned int check (total_pages_planned > 0),
  key_concepts_established text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, topic_key)
);

alter table branches
  add constraint branches_active_topic_fk
  foreign key (active_topic_id) references topics(id) on delete set null;

create table topic_edges (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  from_topic_id uuid references topics(id) on delete cascade not null,
  to_topic_id uuid references topics(id) on delete cascade not null,
  edge_type text not null default 'prerequisite' check (edge_type in ('prerequisite', 'conceptual', 'contrast', 'application')),
  reason text,
  strength numeric not null default 1,
  created_at timestamptz not null default now(),
  unique(from_topic_id, to_topic_id, edge_type)
);

create table topic_source_links (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade not null,
  source_chunk_id uuid references source_chunks(id) on delete cascade not null,
  relevance numeric not null default 1,
  reason text,
  created_at timestamptz not null default now(),
  unique(topic_id, source_chunk_id)
);

create table course_summaries (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null unique,
  user_id uuid references auth.users(id) on delete cascade not null,
  summary text not null,
  complexity text,
  structure_reasoning text,
  branch_count int not null default 0,
  topic_count int not null default 0,
  created_at timestamptz not null default now()
);

create table topic_summaries (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade not null unique,
  summary text not null,
  key_concepts text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references topics(id) on delete cascade not null,
  course_id uuid references courses(id) on delete cascade not null,
  page_number int not null,
  focus text,
  content text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(topic_id, page_number, version)
);

create table page_summaries (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade not null,
  course_id uuid references courses(id) on delete cascade not null,
  summary text not null,
  key_concepts text[] not null default '{}',
  checksum text not null,
  created_at timestamptz not null default now(),
  unique(page_id)
);

create table memory_chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade,
  source_type text not null check (source_type in ('source_chunk', 'page', 'summary', 'chat', 'quiz_evidence')),
  source_id uuid,
  content text not null,
  summary text,
  checksum text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique(course_id, checksum, version)
);

create table embeddings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  memory_chunk_id uuid references memory_chunks(id) on delete cascade not null,
  provider text not null,
  model text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  unique(memory_chunk_id, provider, model)
);

create table doubt_messages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade not null,
  page_id uuid references pages(id) on delete set null,
  page_number int,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table quiz_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade not null,
  type text not null check (type in ('apply', 'spot_error', 'explain')),
  question text not null,
  rubric text,
  created_at timestamptz not null default now()
);

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  questions_asked uuid[] not null default '{}',
  answers jsonb not null default '{}',
  evaluation jsonb not null default '{}',
  overall_level int check (overall_level between 1 and 5),
  passed boolean not null default false,
  created_at timestamptz not null default now()
);

create table progress_events (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade not null,
  topic_id uuid references topics(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  event_type text not null,
  from_state text,
  to_state text,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index source_chunks_course_idx on source_chunks(course_id);
create index branches_course_idx on branches(course_id, position);
create index topics_course_branch_idx on topics(course_id, branch_id, position);
create index topic_edges_course_idx on topic_edges(course_id);
create index pages_topic_idx on pages(topic_id, page_number);
create index memory_chunks_course_topic_idx on memory_chunks(course_id, topic_id);
create index embeddings_vector_idx on embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table courses enable row level security;
alter table course_generation_jobs enable row level security;
alter table sources enable row level security;
alter table source_chunks enable row level security;
alter table branches enable row level security;
alter table topics enable row level security;
alter table topic_edges enable row level security;
alter table topic_source_links enable row level security;
alter table course_summaries enable row level security;
alter table topic_summaries enable row level security;
alter table pages enable row level security;
alter table page_summaries enable row level security;
alter table memory_chunks enable row level security;
alter table embeddings enable row level security;
alter table doubt_messages enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;
alter table progress_events enable row level security;

create policy "own courses" on courses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own jobs" on course_generation_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sources" on sources for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own quiz attempts" on quiz_attempts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own progress events" on progress_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own source chunks" on source_chunks for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own branches" on branches for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own topics" on topics for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own topic edges" on topic_edges for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own topic source links" on topic_source_links for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own course summaries" on course_summaries for all using (
  auth.uid() = user_id
) with check (auth.uid() = user_id);

create policy "own topic summaries" on topic_summaries for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own pages" on pages for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own page summaries" on page_summaries for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own memory chunks" on memory_chunks for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own embeddings" on embeddings for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own doubt messages" on doubt_messages for all using (
  course_id in (select id from courses where user_id = auth.uid())
);

create policy "own quiz questions" on quiz_questions for all using (
  course_id in (select id from courses where user_id = auth.uid())
);
