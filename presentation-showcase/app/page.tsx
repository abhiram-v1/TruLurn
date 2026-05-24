import Link from 'next/link'

export default function LandingPage() {
  return (
    <>
      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <nav className="landing-nav">
        <span className="landing-wordmark">TruLurn</span>
        <div className="landing-nav-actions">
          <Link className="button-quiet" href="/learn/course-ml/linear-regression">
            See it live
          </Link>
          <Link className="button" href="/setup">
            Start learning
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero-split">
        <div className="hero-left">
          <div className="hero-kicker">AI-Guided Mastery System</div>
          <h1 className="hero-heading">
            You finished the course.<br />
            You don&apos;t understand it yet.
          </h1>
          <p className="hero-body">
            TruLurn tracks what you actually understand — not what you completed,
            not what you scored, not whether you kept a streak alive.
            It maps your cognitive depth across five levels and tells you
            exactly where your understanding breaks down.
          </p>
          <div className="hero-actions">
            <Link className="button hero-cta" href="/setup">
              Build my curriculum
            </Link>
            <Link className="button-subtle" href="/learn/course-ml/linear-regression">
              Try it with Machine Learning →
            </Link>
          </div>
          <p className="hero-footnote">
            No account needed to try. AI generates your full curriculum — lessons, roadmap, and quiz pool — before you read a single page.
          </p>
        </div>

        <div className="hero-right">
          {/* Library scene — adapted from the product's visual identity */}
          <svg
            className="hero-scene"
            viewBox="0 0 340 540"
            preserveAspectRatio="xMidYMid slice"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect width="340" height="540" fill="#1C1510" />
            <rect x="0" y="0" width="340" height="200" fill="#1A1208" />
            <rect x="0" y="200" width="340" height="340" fill="#211710" />

            {/* Books row 1 */}
            <rect x="30" y="60" width="60" height="80" fill="#2A1E14" rx="2" />
            <rect x="32" y="62" width="56" height="76" fill="#1E1610" rx="1" />
            <rect x="35" y="65" width="4" height="70" fill="#2E2218" opacity=".9" />
            <rect x="41" y="65" width="3" height="70" fill="#2E2218" opacity=".7" />
            <rect x="46" y="65" width="5" height="70" fill="#2E2218" opacity=".8" />
            <rect x="53" y="65" width="4" height="70" fill="#2E2218" opacity=".9" />
            <rect x="59" y="65" width="3" height="70" fill="#2E2218" opacity=".6" />
            <rect x="64" y="65" width="6" height="70" fill="#2E2218" opacity=".85" />
            <rect x="72" y="65" width="4" height="70" fill="#2E2218" opacity=".7" />
            <rect x="78" y="65" width="5" height="70" fill="#2E2218" opacity=".9" />

            {/* Books row 2 */}
            <rect x="100" y="55" width="55" height="85" fill="#2A1E14" rx="2" />
            <rect x="102" y="57" width="51" height="81" fill="#1E1610" rx="1" />
            <rect x="105" y="60" width="4" height="75" fill="#2E2218" opacity=".85" />
            <rect x="111" y="60" width="3" height="75" fill="#2E2218" opacity=".7" />
            <rect x="116" y="60" width="5" height="75" fill="#2E2218" opacity=".9" />
            <rect x="123" y="60" width="4" height="75" fill="#2E2218" opacity=".8" />
            <rect x="129" y="60" width="3" height="75" fill="#2E2218" opacity=".65" />
            <rect x="134" y="60" width="5" height="75" fill="#2E2218" opacity=".9" />
            <rect x="141" y="60" width="4" height="75" fill="#2E2218" opacity=".75" />
            <rect x="147" y="60" width="3" height="75" fill="#2E2218" opacity=".85" />

            {/* Books row 3 — tallest */}
            <rect x="165" y="45" width="70" height="95" fill="#2A1E14" rx="2" />
            <rect x="167" y="47" width="66" height="91" fill="#1E1610" rx="1" />
            <rect x="170" y="50" width="5" height="85" fill="#2E2218" opacity=".9" />
            <rect x="177" y="50" width="4" height="85" fill="#2E2218" opacity=".7" />
            <rect x="183" y="50" width="6" height="85" fill="#2E2218" opacity=".85" />
            <rect x="191" y="50" width="4" height="85" fill="#2E2218" opacity=".8" />
            <rect x="197" y="50" width="5" height="85" fill="#2E2218" opacity=".7" />
            <rect x="204" y="50" width="4" height="85" fill="#2E2218" opacity=".9" />
            <rect x="210" y="50" width="6" height="85" fill="#2E2218" opacity=".65" />
            <rect x="218" y="50" width="4" height="85" fill="#2E2218" opacity=".85" />
            <rect x="224" y="50" width="5" height="85" fill="#2E2218" opacity=".75" />

            {/* Books row 4 */}
            <rect x="246" y="60" width="50" height="80" fill="#2A1E14" rx="2" />
            <rect x="248" y="62" width="46" height="76" fill="#1E1610" rx="1" />
            <rect x="251" y="65" width="4" height="70" fill="#2E2218" opacity=".85" />
            <rect x="257" y="65" width="3" height="70" fill="#2E2218" opacity=".7" />
            <rect x="262" y="65" width="5" height="70" fill="#2E2218" opacity=".9" />
            <rect x="269" y="65" width="4" height="70" fill="#2E2218" opacity=".8" />
            <rect x="275" y="65" width="3" height="70" fill="#2E2218" opacity=".65" />
            <rect x="280" y="65" width="5" height="70" fill="#2E2218" opacity=".85" />
            <rect x="287" y="65" width="4" height="70" fill="#2E2218" opacity=".75" />

            {/* Books row 5 */}
            <rect x="305" y="50" width="45" height="90" fill="#2A1E14" rx="2" />
            <rect x="307" y="52" width="41" height="86" fill="#1E1610" rx="1" />
            <rect x="310" y="55" width="4" height="80" fill="#2E2218" opacity=".9" />
            <rect x="316" y="55" width="3" height="80" fill="#2E2218" opacity=".7" />
            <rect x="321" y="55" width="5" height="80" fill="#2E2218" opacity=".85" />
            <rect x="328" y="55" width="4" height="80" fill="#2E2218" opacity=".8" />
            <rect x="334" y="55" width="5" height="80" fill="#2E2218" opacity=".65" />

            {/* Shelf edge */}
            <rect x="0" y="138" width="340" height="4" fill="#2E2218" />
            <rect x="0" y="140" width="340" height="2" fill="#3A2C1E" opacity=".5" />

            {/* Desk shadow */}
            <rect x="40" y="142" width="260" height="200" fill="#181008" />
            <rect x="40" y="142" width="260" height="4" fill="#3A2C1E" />
            <rect x="60" y="144" width="220" height="196" fill="#120C06" />

            {/* Open notebook on desk */}
            <rect x="75" y="280" width="190" height="60" fill="#1A1208" />
            <rect x="80" y="282" width="180" height="4" fill="#B8860B" opacity=".18" />
            <rect x="80" y="288" width="170" height="3" fill="#B8860B" opacity=".12" />
            <rect x="80" y="293" width="175" height="3" fill="#B8860B" opacity=".14" />
            <rect x="80" y="298" width="160" height="3" fill="#B8860B" opacity=".1" />
            <rect x="80" y="303" width="172" height="3" fill="#B8860B" opacity=".12" />
            <rect x="80" y="308" width="165" height="3" fill="#B8860B" opacity=".1" />
            <rect x="80" y="313" width="168" height="3" fill="#B8860B" opacity=".11" />
            <rect x="80" y="320" width="145" height="3" fill="#B8860B" opacity=".08" />
            <rect x="80" y="327" width="158" height="3" fill="#B8860B" opacity=".09" />

            {/* Candle */}
            <rect x="148" y="220" width="44" height="8" fill="#2A1A08" />
            <rect x="165" y="210" width="10" height="70" fill="#2A1A08" />
            <polygon points="152,220 188,220 182,210 158,210" fill="#2A1A08" />
            <ellipse cx="170" cy="208" rx="8" ry="5" fill="#D4850A" opacity=".85" />
            <ellipse cx="170" cy="207" rx="5" ry="3" fill="#F5A623" opacity=".9" />
            <ellipse cx="170" cy="207" rx="3" ry="2" fill="#FFC857" opacity=".95" />
            <ellipse cx="170" cy="206" rx="2" ry="1.5" fill="#FFF0A0" opacity=".9" />

            {/* Candle glow */}
            <ellipse cx="170" cy="230" rx="65" ry="20" fill="#B8720A" opacity=".07" />
            <ellipse cx="170" cy="240" rx="80" ry="30" fill="#B8720A" opacity=".04" />

            {/* Book on desk left */}
            <rect x="80" y="345" width="70" height="130" fill="#1C1208" />
            <rect x="82" y="347" width="66" height="126" fill="#171008" />
            <rect x="85" y="350" width="3" height="120" fill="#D4A017" opacity=".06" />
            <rect x="90" y="350" width="2" height="120" fill="#D4A017" opacity=".04" />
            <rect x="94" y="350" width="3" height="120" fill="#D4A017" opacity=".05" />
            <rect x="99" y="350" width="2" height="120" fill="#D4A017" opacity=".04" />
            <rect x="103" y="350" width="3" height="120" fill="#D4A017" opacity=".06" />
            <rect x="108" y="350" width="2" height="120" fill="#D4A017" opacity=".03" />
            <rect x="112" y="350" width="3" height="120" fill="#D4A017" opacity=".05" />

            {/* Open page right */}
            <rect x="160" y="345" width="105" height="130" fill="#1A1008" />
            <rect x="162" y="347" width="101" height="126" fill="#F5E8D0" opacity=".92" />
            <rect x="165" y="352" width="95" height="3" fill="#2C1A0A" opacity=".25" />
            <rect x="165" y="358" width="85" height="3" fill="#2C1A0A" opacity=".2" />
            <rect x="165" y="364" width="90" height="3" fill="#2C1A0A" opacity=".22" />
            <rect x="165" y="370" width="80" height="3" fill="#2C1A0A" opacity=".18" />
            <rect x="165" y="376" width="88" height="3" fill="#2C1A0A" opacity=".2" />
            <rect x="165" y="382" width="82" height="3" fill="#2C1A0A" opacity=".22" />
            <rect x="165" y="388" width="86" height="3" fill="#2C1A0A" opacity=".18" />
            <rect x="165" y="394" width="78" height="3" fill="#2C1A0A" opacity=".2" />
            <rect x="165" y="400" width="84" height="3" fill="#2C1A0A" opacity=".22" />
            <rect x="165" y="406" width="80" height="3" fill="#2C1A0A" opacity=".18" />
            <rect x="165" y="412" width="88" height="3" fill="#2C1A0A" opacity=".2" />
            <rect x="165" y="418" width="75" height="3" fill="#2C1A0A" opacity=".22" />
            <rect x="165" y="424" width="82" height="3" fill="#2C1A0A" opacity=".18" />
            <rect x="165" y="430" width="79" height="3" fill="#2C1A0A" opacity=".2" />
            <rect x="165" y="436" width="86" height="3" fill="#2C1A0A" opacity=".22" />
            <rect x="165" y="442" width="72" height="3" fill="#2C1A0A" opacity=".18" />
            <rect x="165" y="448" width="83" height="3" fill="#2C1A0A" opacity=".2" />
            <rect x="165" y="454" width="76" height="3" fill="#2C1A0A" opacity=".22" />
            <rect x="165" y="460" width="80" height="3" fill="#2C1A0A" opacity=".18" />

            {/* Vine plant */}
            <path d="M195 250 Q200 260 198 275 Q196 285 200 295 Q202 305 199 315 Q197 325 200 340" stroke="#D4A017" strokeWidth="1" fill="none" opacity=".4" />
            <ellipse cx="199" cy="252" rx="4" ry="3" fill="#C8A060" opacity=".5" />
            <ellipse cx="199" cy="260" rx="3" ry="2" fill="#C8A060" opacity=".35" />
            <ellipse cx="198" cy="275" rx="4" ry="2.5" fill="#C8A060" opacity=".4" />

            {/* Small open book */}
            <rect x="93" y="248" width="55" height="70" fill="#1C1410" opacity=".95" />
            <rect x="95" y="250" width="51" height="66" fill="#F5E8D0" opacity=".88" />
            <rect x="145" y="250" width="12" height="68" fill="#2A1E14" />
            <rect x="147" y="252" width="8" height="64" fill="#1A1208" />
            <path d="M110 258 Q118 265 115 275 Q112 282 116 290 Q118 297 114 308" stroke="#8B6914" strokeWidth="1.2" fill="none" opacity=".5" />
            <rect x="98" y="253" width="44" height="3" fill="#8B6914" opacity=".2" />
            <rect x="98" y="258" width="38" height="2" fill="#8B6914" opacity=".15" />
            <rect x="98" y="263" width="41" height="2" fill="#8B6914" opacity=".17" />
            <rect x="98" y="268" width="36" height="2" fill="#8B6914" opacity=".15" />
            <rect x="98" y="273" width="39" height="2" fill="#8B6914" opacity=".17" />
            <rect x="98" y="278" width="35" height="2" fill="#8B6914" opacity=".15" />
            <rect x="98" y="283" width="38" height="2" fill="#8B6914" opacity=".17" />
            <rect x="98" y="288" width="34" height="2" fill="#8B6914" opacity=".14" />
            <rect x="98" y="293" width="37" height="2" fill="#8B6914" opacity=".16" />
            <rect x="98" y="298" width="33" height="2" fill="#8B6914" opacity=".14" />
            <rect x="98" y="303" width="36" height="2" fill="#8B6914" opacity=".16" />
            <rect x="98" y="308" width="32" height="2" fill="#8B6914" opacity=".14" />

            {/* Desk shelf items */}
            <rect x="30" y="482" width="90" height="20" fill="#1C1208" />
            <rect x="32" y="484" width="86" height="16" fill="#171008" />
            <rect x="35" y="486" width="3" height="12" fill="#D4A017" opacity=".06" />
            <rect x="40" y="486" width="2" height="12" fill="#D4A017" opacity=".04" />
            <rect x="44" y="486" width="3" height="12" fill="#D4A017" opacity=".05" />
            <rect x="49" y="486" width="2" height="12" fill="#D4A017" opacity=".04" />
            <rect x="53" y="486" width="3" height="12" fill="#D4A017" opacity=".06" />
            <rect x="135" y="482" width="70" height="18" fill="#1A1208" />
            <rect x="137" y="484" width="66" height="14" fill="#F5E8D0" opacity=".7" />
            <rect x="220" y="482" width="90" height="20" fill="#1C1208" />
            <rect x="222" y="484" width="86" height="16" fill="#171008" />
            <rect x="225" y="486" width="3" height="12" fill="#D4A017" opacity=".04" />
            <rect x="230" y="486" width="2" height="12" fill="#D4A017" opacity=".06" />
            <rect x="234" y="486" width="3" height="12" fill="#D4A017" opacity=".05" />

            {/* Desk glow */}
            <ellipse cx="175" cy="390" rx="90" ry="12" fill="#D4850A" opacity=".04" />
            <ellipse cx="175" cy="410" rx="100" ry="16" fill="#D4850A" opacity=".025" />

            {/* Vignette top/bottom */}
            <rect x="0" y="0" width="340" height="100" fill="#0A0604" opacity=".5" />
            <rect x="0" y="440" width="340" height="100" fill="#0A0604" opacity=".3" />
          </svg>

          <div className="hero-caption">
            <div className="hero-caption-label">Currently reading</div>
            <div className="hero-caption-text">Machine Learning · Linear Regression, page 2 of 3</div>
          </div>
        </div>
      </section>

      {/* ── Contrast ─────────────────────────────────────────────────── */}
      <section className="contrast-section">
        <div className="contrast-inner">
          <div className="contrast-header">
            <div className="section-label" style={{ color: 'rgba(253,247,237,0.45)' }}>What changes</div>
            <h2 className="contrast-heading">
              Built for understanding,<br />not the illusion of it.
            </h2>
            <p className="contrast-sub">
              Most learning tools are designed around engagement — streaks, scores, and completion percentages that feel like progress. TruLurn is designed around one thing: whether you actually understand.
            </p>
          </div>

          <div className="contrast-table">
            <div className="contrast-col contrast-col-old">
              <div className="contrast-col-title">Other tools</div>
              <div className="contrast-item">
                <span className="contrast-dash">—</span>
                Track content completion
              </div>
              <div className="contrast-item">
                <span className="contrast-dash">—</span>
                Show quiz scores as percentages
              </div>
              <div className="contrast-item">
                <span className="contrast-dash">—</span>
                One chat thread for everything
              </div>
              <div className="contrast-item">
                <span className="contrast-dash">—</span>
                Static learning paths you check off
              </div>
              <div className="contrast-item">
                <span className="contrast-dash">—</span>
                Encouraging AI that avoids friction
              </div>
              <div className="contrast-item">
                <span className="contrast-dash">—</span>
                Multiple choice quizzes
              </div>
            </div>

            <div className="contrast-divider" />

            <div className="contrast-col contrast-col-new">
              <div className="contrast-col-title">TruLurn</div>
              <div className="contrast-item">
                <span className="contrast-check">↗</span>
                Infers your cognitive state across five levels
              </div>
              <div className="contrast-item">
                <span className="contrast-check">↗</span>
                Shows only color states — Unstable, Partial, Functional, Mastered
              </div>
              <div className="contrast-item">
                <span className="contrast-check">↗</span>
                Three isolated spaces: learn, doubt, test — never mixed
              </div>
              <div className="contrast-item">
                <span className="contrast-check">↗</span>
                Adaptive roadmap that unlocks and blocks based on actual understanding
              </div>
              <div className="contrast-item">
                <span className="contrast-check">↗</span>
                Strict AI that names confusion and catches false confidence
              </div>
              <div className="contrast-item">
                <span className="contrast-check">↗</span>
                Open-ended questions: Apply, Spot the Error, Explain
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Three spaces ─────────────────────────────────────────────── */}
      <section className="spaces-section">
        <div className="spaces-inner">
          <div className="section-label">Three isolated spaces</div>
          <h2 className="spaces-heading">Learn. Ask. Test.<br />Each one has a single job.</h2>
          <p className="spaces-sub">
            Every confusion in learning comes from mixing things that shouldn&apos;t be mixed — reading and questioning and testing, all in one stream. TruLurn separates them. Each space is strict about its role.
          </p>

          <div className="spaces-grid">
            <div className="space-card">
              <div className="space-tag space-tag-learn">Learn</div>
              <h3 className="space-title">Structured lessons</h3>
              <p className="space-body">
                Paginated, AI-authored content that you read like a book. No chat input in the lesson — ever. If you want to go deeper, click a button. The AI rewrites that section. The core content stays stable.
              </p>
              <div className="space-rule">
                No text input. No free-form. Only next and previous.
              </div>
            </div>

            <div className="space-card">
              <div className="space-tag space-tag-ask">Ask</div>
              <h3 className="space-title">Scoped doubt chat</h3>
              <p className="space-body">
                The right panel is the only place you type freely. But it&apos;s locked to the topic you&apos;re on. Ask about gradient descent while studying linear regression and the AI redirects you. History is stored per-topic, not globally.
              </p>
              <div className="space-rule">
                Context: always visible. Scope: always enforced.
              </div>
            </div>

            <div className="space-card">
              <div className="space-tag space-tag-test">Test</div>
              <h3 className="space-title">Adversarial quiz</h3>
              <p className="space-body">
                Three open-ended question types designed to distinguish between students who memorized the procedure and students who understood the mechanism. Results update your roadmap immediately — and can regress topics you thought were done.
              </p>
              <div className="space-rule">
                No hints. No multiple choice. No partial credit for vague answers.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Cognitive model ──────────────────────────────────────────── */}
      <section className="levels-section">
        <div className="levels-inner">
          <div className="section-label">Cognitive model</div>
          <h2 className="levels-heading">Five levels. No scores.</h2>
          <p className="levels-sub">
            A score tells you how many you got right. A level tells you what you&apos;re actually ready to do. TruLurn tracks the difference between knowing a formula and understanding why it works.
          </p>

          <div className="levels-row">
            <div className="level-card">
              <div className="level-num">L1</div>
              <div className="level-name">Recognition</div>
              <div className="level-desc">Has seen the concept. Can identify it. Cannot explain it.</div>
            </div>
            <div className="levels-arrow">→</div>
            <div className="level-card">
              <div className="level-num">L2</div>
              <div className="level-name">Mechanical</div>
              <div className="level-desc">Can follow the procedure. Doesn&apos;t understand why it works.</div>
            </div>
            <div className="levels-arrow">→</div>
            <div className="level-card level-card-mid">
              <div className="level-num">L3</div>
              <div className="level-name">Conceptual</div>
              <div className="level-desc">Understands why. Can explain the mechanism, not just the steps.</div>
            </div>
            <div className="levels-arrow">→</div>
            <div className="level-card">
              <div className="level-num">L4</div>
              <div className="level-name">Transfer</div>
              <div className="level-desc">Applies correctly in a new context not seen during learning.</div>
            </div>
            <div className="levels-arrow">→</div>
            <div className="level-card">
              <div className="level-num">L5</div>
              <div className="level-name">Intuitive</div>
              <div className="level-desc">Predicts behavior. Explains to others. No hesitation on edge cases.</div>
            </div>
          </div>

          <div className="levels-note">
            Most students complete a topic at L2 and feel done. TruLurn catches this.
          </div>

          <div className="states-row">
            <div className="state-group">
              <div className="state-swatch state-swatch-unstable" />
              <div className="state-info">
                <div className="state-name">Unstable</div>
                <div className="state-meaning">Foundation broken or never built. Blocks progression.</div>
              </div>
            </div>
            <div className="state-group">
              <div className="state-swatch state-swatch-partial" />
              <div className="state-info">
                <div className="state-name">Partial</div>
                <div className="state-meaning">Mechanical understanding only. Conceptual questions queued.</div>
              </div>
            </div>
            <div className="state-group">
              <div className="state-swatch state-swatch-functional" />
              <div className="state-info">
                <div className="state-name">Functional</div>
                <div className="state-meaning">Conceptual grasp. Understands the why, not just the how.</div>
              </div>
            </div>
            <div className="state-group">
              <div className="state-swatch state-swatch-mastered" />
              <div className="state-info">
                <div className="state-name">Mastered</div>
                <div className="state-meaning">Transferable and intuitive. Adjacent topics unlock.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Quiz types ───────────────────────────────────────────────── */}
      <section className="quiz-explain-section">
        <div className="quiz-explain-inner">
          <div className="section-label">The quiz</div>
          <h2 className="quiz-explain-heading">Three questions. All open-ended. All designed to catch what you think you know.</h2>

          <div className="qtype-grid">
            <div className="qtype-card">
              <div className="qtype-header">
                <span className="qtype-badge">Apply</span>
                <span className="qtype-tests">Tests transfer — L4</span>
              </div>
              <div className="qtype-example">
                &ldquo;A housing model predicts prices using square footage. It works well for average homes but badly for luxury ones. What does this tell you about the linear assumption?&rdquo;
              </div>
              <div className="qtype-rule">
                Correct procedure is not enough. You must explain the mechanism.
              </div>
            </div>

            <div className="qtype-card">
              <div className="qtype-header">
                <span className="qtype-badge">Spot the Error</span>
                <span className="qtype-tests">Tests conceptual — L3</span>
              </div>
              <div className="qtype-example">
                &ldquo;A student says: &lsquo;I increased my learning rate and loss went down faster, so higher is always better.&rsquo; What&apos;s wrong with this?&rdquo;
              </div>
              <div className="qtype-rule">
                You must name what breaks and why — not just say it&apos;s wrong.
              </div>
            </div>

            <div className="qtype-card">
              <div className="qtype-header">
                <span className="qtype-badge">Explain It</span>
                <span className="qtype-tests">Tests intuition — L5</span>
              </div>
              <div className="qtype-example">
                &ldquo;Explain gradient descent to someone who only knows basic algebra. No formulas.&rdquo;
              </div>
              <div className="qtype-rule">
                If you can&apos;t explain it plainly, you don&apos;t fully understand it.
              </div>
            </div>
          </div>

          <div className="qtype-note">
            A pool of ten questions per topic is generated before you start. Four or five are served each session, sampled from the pool. The AI evaluates your answer honestly — vague answers that sound right are caught.
          </div>
        </div>
      </section>

      {/* ── The loop ─────────────────────────────────────────────────── */}
      <section className="loop-section">
        <div className="loop-inner">
          <div className="section-label">The learning loop</div>
          <h2 className="loop-heading">Every session follows the same path. Nothing is skipped.</h2>

          <div className="loop-steps">
            <div className="loop-step">
              <div className="loop-step-num">01</div>
              <div className="loop-step-content">
                <div className="loop-step-title">Read the lesson</div>
                <div className="loop-step-body">Paginated, focused. One idea per page. Controls to simplify, go deeper, or add an example — but never a free-form chat in the lesson view.</div>
              </div>
            </div>
            <div className="loop-connector" />
            <div className="loop-step">
              <div className="loop-step-num">02</div>
              <div className="loop-step-content">
                <div className="loop-step-title">Ask your doubts</div>
                <div className="loop-step-body">The doubt chat is the only place you type freely. It&apos;s scoped to the current topic and page. History stays per-topic — not one global stream.</div>
              </div>
            </div>
            <div className="loop-connector" />
            <div className="loop-step">
              <div className="loop-step-num">03</div>
              <div className="loop-step-content">
                <div className="loop-step-title">Take the quiz</div>
                <div className="loop-step-body">Open-ended answers. The AI evaluates depth, not length. You get specific feedback and a cognitive level — not a score.</div>
              </div>
            </div>
            <div className="loop-connector" />
            <div className="loop-step">
              <div className="loop-step-num">04</div>
              <div className="loop-step-content">
                <div className="loop-step-title">Roadmap updates</div>
                <div className="loop-step-body">Topics unlock, get blocked, or regress based on your quiz results. A mastered topic can become unstable later. The map reflects reality, not effort.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <section className="cta-section">
        <div className="cta-inner">
          <h2 className="cta-heading">Start with any topic.</h2>
          <p className="cta-body">
            Describe what you want to learn and your goals. TruLurn generates your full curriculum — roadmap, lesson pages, and quiz pool — before you read a single line. No uploads. No configuration.
          </p>
          <div className="cta-actions">
            <Link className="button cta-main-btn" href="/setup">
              Build my curriculum
            </Link>
            <Link className="button-subtle" href="/learn/course-ml/linear-regression">
              Try it live with Machine Learning →
            </Link>
          </div>
          <p className="cta-footnote">
            Mode B: AI generates content from its own knowledge. A hallucination warning is always visible. Mode A (source upload) is coming.
          </p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="landing-footer">
        <span className="landing-wordmark" style={{ fontSize: 'var(--text-sm)' }}>TruLurn</span>
        <span className="landing-footer-copy">Built for learners who want to actually understand.</span>
      </footer>
    </>
  )
}
