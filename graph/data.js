// Knowledge graph data — Machine Learning Foundations course.
// Nodes laid out in layered columns: foundations → core → algorithms → neural → advanced.
// State: mastered | functional | partial | unstable | active | locked
// Importance: 1 (small), 2 (medium), 3 (large) — affects node size
// Difficulty: 1..5
// All numeric x/y are in a 1640 × 900 SVG coordinate space.

window.GRAPH_DATA = {
  course: {
    id: 'course-ml',
    title: 'Machine Learning Foundations',
    topicCount: 32,
    mastered: 6,
    functional: 4,
    partial: 5,
    unstable: 2,
    active: 1,
    locked: 14,
  },

  branches: [
    { id: 'foundations',  title: 'Foundations',           topicCount: 3, mastered: 3, color: 'mastered' },
    { id: 'supervised',   title: 'Supervised Learning',   topicCount: 7, mastered: 2, color: 'active', active: true },
    { id: 'unsupervised', title: 'Unsupervised Learning', topicCount: 4, mastered: 0, color: 'locked' },
    { id: 'ensemble',     title: 'Trees & Ensembles',     topicCount: 3, mastered: 0, color: 'locked' },
    { id: 'neural',       title: 'Neural Networks',       topicCount: 5, mastered: 0, color: 'locked' },
    { id: 'deep',         title: 'Deep Learning',         topicCount: 4, mastered: 0, color: 'locked' },
    { id: 'reinforcement',title: 'Reinforcement Learning',topicCount: 4, mastered: 0, color: 'locked' },
    { id: 'evaluation',   title: 'Evaluation & Metrics',  topicCount: 2, mastered: 1, color: 'partial' },
  ],

  nodes: [
    // ── Foundations (col 1) ──
    { id: 'linalg',     title: 'Linear Algebra',      branch: 'foundations',  x: 80,   y: 220, w: 168, importance: 2, state: 'mastered',  difficulty: 2, mastery: 92, deps: 0, section: 'Math foundations' },
    { id: 'calc',       title: 'Calculus',            branch: 'foundations',  x: 80,   y: 380, w: 168, importance: 2, state: 'mastered',  difficulty: 2, mastery: 88, deps: 0, section: 'Math foundations' },
    { id: 'prob',       title: 'Probability',         branch: 'foundations',  x: 80,   y: 540, w: 168, importance: 2, state: 'mastered',  difficulty: 3, mastery: 84, deps: 0, section: 'Math foundations' },

    // ── Supervised intro (col 2) ──
    { id: 'linreg',     title: 'Linear Regression',   branch: 'supervised',   x: 300,  y: 220, w: 184, importance: 3, state: 'active',    difficulty: 2, mastery: 38, deps: 1, section: 'Supervised Learning', current: true },
    { id: 'cost',       title: 'Cost Functions',      branch: 'supervised',   x: 300,  y: 360, w: 184, importance: 2, state: 'partial',   difficulty: 3, mastery: 52, deps: 1, section: 'Supervised Learning' },
    { id: 'loss',       title: 'Loss Functions',      branch: 'supervised',   x: 300,  y: 500, w: 184, importance: 2, state: 'functional',difficulty: 3, mastery: 68, deps: 2, section: 'Supervised Learning' },
    { id: 'gd',         title: 'Gradient Descent',    branch: 'supervised',   x: 300,  y: 640, w: 184, importance: 3, state: 'partial',   difficulty: 4, mastery: 44, deps: 2, section: 'Optimization', suggested: true },

    // ── Model behavior (col 3) ──
    { id: 'logreg',     title: 'Logistic Regression', branch: 'supervised',   x: 540,  y: 160, w: 184, importance: 2, state: 'locked',    difficulty: 3, mastery: 0,  deps: 2, section: 'Classification' },
    { id: 'overfit',    title: 'Overfitting',         branch: 'supervised',   x: 540,  y: 290, w: 184, importance: 3, state: 'unstable',  difficulty: 3, mastery: 28, deps: 2, section: 'Model Behavior', misconception: true },
    { id: 'biasvar',    title: 'Bias–Variance',       branch: 'supervised',   x: 540,  y: 420, w: 184, importance: 2, state: 'unstable',  difficulty: 4, mastery: 22, deps: 2, section: 'Model Behavior' },
    { id: 'regular',    title: 'Regularization',      branch: 'supervised',   x: 540,  y: 550, w: 184, importance: 2, state: 'locked',    difficulty: 4, mastery: 0,  deps: 2, section: 'Model Behavior' },
    { id: 'crossval',   title: 'Cross-Validation',    branch: 'evaluation',   x: 540,  y: 680, w: 184, importance: 2, state: 'partial',   difficulty: 2, mastery: 55, deps: 1, section: 'Evaluation' },

    // ── Algorithms (col 4) ──
    { id: 'dtree',      title: 'Decision Trees',      branch: 'ensemble',     x: 780,  y: 130, w: 168, importance: 2, state: 'locked',    difficulty: 3, mastery: 0,  deps: 2, section: 'Trees & Ensembles' },
    { id: 'rf',         title: 'Random Forest',       branch: 'ensemble',     x: 780,  y: 250, w: 168, importance: 2, state: 'locked',    difficulty: 3, mastery: 0,  deps: 1, section: 'Trees & Ensembles' },
    { id: 'boost',      title: 'Gradient Boosting',   branch: 'ensemble',     x: 780,  y: 370, w: 168, importance: 2, state: 'locked',    difficulty: 4, mastery: 0,  deps: 2, section: 'Trees & Ensembles' },
    { id: 'kmeans',     title: 'K-Means',             branch: 'unsupervised', x: 780,  y: 500, w: 168, importance: 2, state: 'locked',    difficulty: 2, mastery: 0,  deps: 1, section: 'Clustering' },
    { id: 'pca',        title: 'PCA',                 branch: 'unsupervised', x: 780,  y: 620, w: 168, importance: 2, state: 'locked',    difficulty: 4, mastery: 0,  deps: 2, section: 'Dim. Reduction' },
    { id: 'hier',       title: 'Hierarchical',        branch: 'unsupervised', x: 780,  y: 740, w: 168, importance: 1, state: 'locked',    difficulty: 3, mastery: 0,  deps: 1, section: 'Clustering' },

    // ── Neural Nets (col 5) ──
    { id: 'perceptron', title: 'Perceptron',          branch: 'neural',       x: 1020, y: 180, w: 168, importance: 2, state: 'locked',    difficulty: 2, mastery: 0,  deps: 2, section: 'Neural Networks' },
    { id: 'activ',      title: 'Activations',         branch: 'neural',       x: 1020, y: 300, w: 168, importance: 1, state: 'locked',    difficulty: 2, mastery: 0,  deps: 1, section: 'Neural Networks' },
    { id: 'mlp',        title: 'MLP',                 branch: 'neural',       x: 1020, y: 420, w: 168, importance: 3, state: 'locked',    difficulty: 4, mastery: 0,  deps: 3, section: 'Neural Networks' },
    { id: 'backprop',   title: 'Backpropagation',     branch: 'neural',       x: 1020, y: 550, w: 168, importance: 3, state: 'locked',    difficulty: 5, mastery: 0,  deps: 2, section: 'Neural Networks' },
    { id: 'tsne',       title: 't-SNE',               branch: 'unsupervised', x: 1020, y: 700, w: 168, importance: 1, state: 'locked',    difficulty: 4, mastery: 0,  deps: 2, section: 'Dim. Reduction' },

    // ── Advanced / Deep (col 6) ──
    { id: 'cnn',        title: 'CNN',                 branch: 'deep',         x: 1260, y: 200, w: 152, importance: 3, state: 'locked',    difficulty: 4, mastery: 0,  deps: 2, section: 'Deep Learning' },
    { id: 'rnn',        title: 'RNN',                 branch: 'deep',         x: 1260, y: 320, w: 152, importance: 2, state: 'locked',    difficulty: 4, mastery: 0,  deps: 2, section: 'Deep Learning' },
    { id: 'attn',       title: 'Attention',           branch: 'deep',         x: 1260, y: 440, w: 152, importance: 3, state: 'locked',    difficulty: 5, mastery: 0,  deps: 2, section: 'Deep Learning' },
    { id: 'transformer',title: 'Transformers',        branch: 'deep',         x: 1460, y: 380, w: 152, importance: 3, state: 'locked',    difficulty: 5, mastery: 0,  deps: 3, section: 'Deep Learning' },

    // ── RL (bottom row) ──
    { id: 'mdp',        title: 'Markov Decision Proc.',branch: 'reinforcement',x: 1020, y: 820, w: 192, importance: 2, state: 'locked',   difficulty: 4, mastery: 0,  deps: 1, section: 'Reinforcement Learning' },
    { id: 'qlearn',     title: 'Q-Learning',          branch: 'reinforcement',x: 1260, y: 700, w: 152, importance: 2, state: 'locked',    difficulty: 4, mastery: 0,  deps: 2, section: 'Reinforcement Learning' },
    { id: 'policy',     title: 'Policy Gradient',     branch: 'reinforcement',x: 1460, y: 600, w: 168, importance: 2, state: 'locked',    difficulty: 5, mastery: 0,  deps: 2, section: 'Reinforcement Learning' },

    // ── Evaluation island ──
    { id: 'metrics',    title: 'Classification Metrics',branch: 'evaluation', x: 1020, y: 60,  w: 192, importance: 1, state: 'functional',difficulty: 2, mastery: 70, deps: 1, section: 'Evaluation' },
  ],

  // Edges: from → to.  strength: weak | medium | strong.  Mark critical-path edges.
  edges: [
    // Foundations → supervised
    { from: 'linalg', to: 'linreg',      strength: 'strong', critical: true },
    { from: 'calc',   to: 'cost',        strength: 'strong' },
    { from: 'calc',   to: 'gd',          strength: 'strong', critical: true },
    { from: 'prob',   to: 'loss',        strength: 'strong' },
    { from: 'prob',   to: 'crossval',    strength: 'medium' },
    { from: 'linalg', to: 'pca',         strength: 'strong' },

    // Supervised internal
    { from: 'linreg', to: 'cost',        strength: 'strong', critical: true },
    { from: 'linreg', to: 'logreg',      strength: 'strong' },
    { from: 'linreg', to: 'overfit',     strength: 'medium' },
    { from: 'cost',   to: 'gd',          strength: 'strong', critical: true },
    { from: 'loss',   to: 'gd',          strength: 'medium' },
    { from: 'gd',     to: 'backprop',    strength: 'strong', critical: true },

    // Model behavior
    { from: 'overfit',to: 'biasvar',     strength: 'strong' },
    { from: 'overfit',to: 'regular',     strength: 'strong' },
    { from: 'biasvar',to: 'crossval',    strength: 'medium' },
    { from: 'regular',to: 'rf',          strength: 'weak' },

    // Algorithms
    { from: 'logreg', to: 'dtree',       strength: 'weak' },
    { from: 'logreg', to: 'metrics',     strength: 'medium' },
    { from: 'dtree',  to: 'rf',          strength: 'strong' },
    { from: 'rf',     to: 'boost',       strength: 'strong' },
    { from: 'dtree',  to: 'boost',       strength: 'medium' },
    { from: 'kmeans', to: 'hier',        strength: 'medium' },
    { from: 'kmeans', to: 'pca',         strength: 'weak' },
    { from: 'pca',    to: 'tsne',        strength: 'strong' },

    // Neural
    { from: 'logreg', to: 'perceptron',  strength: 'strong' },
    { from: 'perceptron', to: 'mlp',     strength: 'strong' },
    { from: 'activ',  to: 'mlp',         strength: 'medium' },
    { from: 'mlp',    to: 'backprop',    strength: 'strong', critical: true },
    { from: 'backprop',to: 'cnn',        strength: 'strong' },
    { from: 'backprop',to: 'rnn',        strength: 'strong' },
    { from: 'mlp',    to: 'cnn',         strength: 'medium' },

    // Deep
    { from: 'cnn',    to: 'attn',        strength: 'weak' },
    { from: 'rnn',    to: 'attn',        strength: 'strong' },
    { from: 'attn',   to: 'transformer', strength: 'strong' },
    { from: 'rnn',    to: 'transformer', strength: 'medium' },

    // RL
    { from: 'prob',   to: 'mdp',         strength: 'medium' },
    { from: 'mdp',    to: 'qlearn',      strength: 'strong' },
    { from: 'qlearn', to: 'policy',      strength: 'medium' },
    { from: 'backprop',to: 'policy',     strength: 'weak' },

    // Evaluation
    { from: 'crossval',to: 'metrics',    strength: 'medium' },
  ],
};
