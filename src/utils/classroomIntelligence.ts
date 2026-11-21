import {
  ConfusionReason,
  ConfusionSpike,
  RescuePollDraft,
  TopicRevisionPack,
  TopicSummary,
} from "../types";

interface TopicKnowledgeTemplate {
  keywords: string[];
  rescuePoll: {
    question: string;
    options: [string, string, string];
    correctIndex: number;
    rationale: string;
  };
  bullets: [string, string, string];
  practice: [
    {
      question: string;
      options: string[];
      correctIndex: number;
      explanation: string;
    },
    {
      question: string;
      options: string[];
      correctIndex: number;
      explanation: string;
    }
  ];
}

const DOMAIN_TEMPLATES: TopicKnowledgeTemplate[] = [
  {
    keywords: ["recurs", "base case", "call stack", "fibonacci", "factorial"],
    rescuePoll: {
      question:
        "In a recursive function, what prevents infinite self-calls and a stack overflow?",
      options: [
        "A reachable base case that returns without recursing",
        "Using a global counter inside the loop header",
        "Increasing the heap size before calling the function",
      ],
      correctIndex: 0,
      rationale:
        "Every recursive path must converge toward a terminating base case so stack frames unwind cleanly.",
    },
    bullets: [
      "Always verify the base case first: it defines when recursion stops and starts returning values back up the stack.",
      "Trace each recursive call as a suspended stack frame holding its own local parameters until the inner call resolves.",
      "Ensure every recursive branch moves the input strictly closer to the base case (e.g., n - 1 or smaller subproblem).",
    ],
    practice: [
      {
        question:
          "If f(n) calls f(n - 2) with base case n == 0 only, what happens for f(5)?",
        options: [
          "It returns cleanly after 3 steps",
          "It skips 0 into negative numbers and overflows the stack",
          "It automatically converts to an iterative loop",
        ],
        correctIndex: 1,
        explanation:
          "5 -> 3 -> 1 -> -1 -> -3... never hits n == 0, so a safe base case should guard n <= 1.",
      },
      {
        question:
          "Where are local variables stored for each pending recursive call?",
        options: [
          "On separate frames on the call stack",
          "Overwritten in a single shared static variable",
          "Deleted immediately upon the nested call",
        ],
        correctIndex: 0,
        explanation:
          "Each invocation receives an isolated stack frame preserving its local state until control returns.",
      },
    ],
  },
  {
    keywords: ["pointer", "memory", "malloc", "heap", "stack", "dereferenc", "alloc"],
    rescuePoll: {
      question:
        "If `int *p = &x;`, what happens when you modify `*p = 42`?",
      options: [
        "It changes the memory address stored inside p to 42",
        "It updates the value stored in x via dereferencing",
        "It allocates a new block on the heap at address 42",
      ],
      correctIndex: 1,
      rationale:
        "Dereferencing (*p) accesses the value at the address p points to, mutating x directly.",
    },
    bullets: [
      "Separate address vs. value: `&x` yields the memory address of `x`, whereas `*p` follows the pointer to read or write the value.",
      "Stack allocations free automatically on function return; dynamic heap blocks (`malloc`/`new`) persist until explicitly freed.",
      "Check for null pointers before dereferencing and reset freed pointers to `NULL` to prevent dangling pointer bugs.",
    ],
    practice: [
      {
        question:
          "What is the primary cause of a memory leak in manual memory management?",
        options: [
          "Losing the last pointer to heap-allocated memory without freeing it",
          "Declaring too many local integers inside a loop",
          "Using const references for read-only parameters",
        ],
        correctIndex: 0,
        explanation:
          "Once no pointer references an allocated heap block, it can never be reclaimed during program execution.",
      },
      {
        question:
          "Which operator retrieves the memory address of an existing variable `val`?",
        options: ["*val", "&val", "->val"],
        correctIndex: 1,
        explanation:
          "The address-of operator `&` returns the memory location where `val` resides.",
      },
    ],
  },
  {
    keywords: ["edge case", "boundary", "empty", "null", "corner", "overflow"],
    rescuePoll: {
      question:
        "Which input class should you test FIRST when checking algorithm boundary safety?",
      options: [
        "Empty input, single element, and max/min limits",
        "Only sorted arrays of length 10",
        "Random strings with average length",
      ],
      correctIndex: 0,
      rationale:
        "Most off-by-one, null-dereference, and division-by-zero defects trigger at size 0, size 1, or boundary limits.",
    },
    bullets: [
      "Guard size-0 and size-1 inputs explicitly before indexing `arr[0]` or `arr[n - 1]`.",
      "Double-check loop inequalities (`<` vs `<=`) at both ends so the last valid index is neither skipped nor exceeded.",
      "Watch for integer overflow in midpoint math: prefer `low + (high - low) / 2` over `(low + high) / 2`.",
    ],
    practice: [
      {
        question:
          "Why does `mid = (low + high) / 2` risk failure on very large indices?",
        options: [
          "It can overflow signed 32-bit integers before dividing by 2",
          "Integer division always rounds upward",
          "It modifies both low and high in place",
        ],
        correctIndex: 0,
        explanation:
          "Adding two large indices can exceed INT_MAX; `low + (high - low) / 2` stays within bounds.",
      },
      {
        question:
          "In a loop iterating `i` from `0` to `n`, which bound prevents reading past the end of an n-element array?",
        options: ["i <= n", "i < n", "i != n + 1"],
        correctIndex: 1,
        explanation:
          "Zero-indexed arrays have valid indices `0` through `n - 1`, matching `i < n`.",
      },
    ],
  },
  {
    keywords: ["example", "worked", "step", "trace", "walkthrough", "demo"],
    rescuePoll: {
      question:
        "During a step-by-step trace, what is the best way to verify your logic?",
      options: [
        "Track variable values row-by-row on a small 3-element input",
        "Assume intermediate steps match the final output",
        "Skip the loop initialization and check only the return line",
      ],
      correctIndex: 0,
      rationale:
        "A concrete trace table on a tiny input exposes state drift and off-by-one errors immediately.",
    },
    bullets: [
      "Write a state-trace table showing every key variable before and after each iteration on a 3–4 item sample.",
      "Verify the loop invariant: confirm what condition stays true before the loop, during each pass, and at exit.",
      "Compare your manual trace output against the expected result before scaling up to complex inputs.",
    ],
    practice: [
      {
        question:
          "What makes a worked example most effective for catching logic bugs?",
        options: [
          "Recording intermediate variable states after every step",
          "Choosing the largest possible dataset right away",
          "Ignoring branch conditions that look obvious",
        ],
        correctIndex: 0,
        explanation:
          "Explicitly logging each intermediate state reveals subtle mutations and boundary errors.",
      },
      {
        question: "What does a loop invariant describe?",
        options: [
          "A property that remains true before and after each loop iteration",
          "A constant that cannot be used inside a loop",
          "The total runtime in milliseconds",
        ],
        correctIndex: 0,
        explanation:
          "Loop invariants link initialization, maintenance per step, and correctness upon termination.",
      },
    ],
  },
  {
    keywords: ["complex", "big o", "search", "sort", "tree", "graph", "dynamic", "dp", "hash"],
    rescuePoll: {
      question:
        "When an algorithm halves the remaining search space on every step, what is its time complexity?",
      options: ["O(log n)", "O(n)", "O(n log n)"],
      correctIndex: 0,
      rationale:
        "Repeatedly dividing problem size n by 2 takes at most log2(n) iterations.",
    },
    bullets: [
      "Identify how work scales with input size `n`: halving input gives `O(log n)`, single pass gives `O(n)`, nested loops give `O(n^2)`.",
      "Always check preconditions: e.g., binary search requires sorted order, and DP requires overlapping subproblems + optimal substructure.",
      "Distinguish worst-case vs. average-case complexity (e.g., hash lookups average `O(1)` vs. `O(n)` worst-case collisions).",
    ],
    practice: [
      {
        question:
          "Which condition must hold before applying standard binary search to an array?",
        options: [
          "The array elements must be sorted in monotonic order",
          "All array values must be positive integers",
          "The array length must be a power of 2",
        ],
        correctIndex: 0,
        explanation:
          "Binary search discards half the range based on order comparisons, which is valid only on sorted data.",
      },
      {
        question:
          "What is the primary purpose of memoization in dynamic programming?",
        options: [
          "Cache solved subproblem results to avoid redundant recomputation",
          "Sort subproblems alphabetically before execution",
          "Replace all recursion with random sampling",
        ],
        correctIndex: 0,
        explanation:
          "Storing previously computed subproblem outputs reduces exponential recursion to polynomial time.",
      },
    ],
  },
];

function matchTemplate(topic: string): TopicKnowledgeTemplate | null {
  const haystack = topic.toLowerCase();
  for (const tpl of DOMAIN_TEMPLATES) {
    if (tpl.keywords.some((kw) => haystack.includes(kw))) {
      return tpl;
    }
  }
  return null;
}

export function generateRescuePollDraft(
  topic: string,
  topReason: ConfusionReason | null
): RescuePollDraft {
  const cleanTopic = topic.trim() || "Current Concept";
  const matched = matchTemplate(cleanTopic);

  if (matched) {
    return {
      question: `[${cleanTopic}] ${matched.rescuePoll.question}`.slice(0, 235),
      options: matched.rescuePoll.options,
      correctOptionIndex: matched.rescuePoll.correctIndex,
      rationale: matched.rescuePoll.rationale,
    };
  }

  const reasonNote =
    topReason === "Need Example"
      ? "which concrete example resolves the confusion"
      : topReason === "Missed a Step"
      ? "which transition step is essential"
      : "which statement accurately holds";

  return {
    question: `Quick check on "${cleanTopic}": ${reasonNote}?`.slice(0, 235),
    options: [
      `Verifying the core rule & boundary condition of ${cleanTopic.slice(0, 42)}`,
      `Skipping intermediate assumptions to jump straight to output`,
      `Applying an unrelated formula without checking prerequisites`,
    ],
    correctOptionIndex: 0,
    rationale: `Highlighting the core rule and prerequisites directly targets ${
      topReason || "conceptual clarity"
    }.`,
  };
}

export function generateTopicRevisionPack(
  topicSummary: TopicSummary,
  _spikes: ConfusionSpike[] = []
): TopicRevisionPack {
  const matched = matchTemplate(topicSummary.topic);

  if (matched) {
    return {
      topic: topicSummary.topic,
      peakConfusionPct: topicSummary.peakConfusionPct,
      topReason: topicSummary.topReason,
      bullets: matched.bullets,
      practiceQuestions: matched.practice,
    };
  }

  const reasonAdvice =
    topicSummary.topReason === "Too Fast"
      ? "Walk slowly through each transition step on paper before coding or solving."
      : topicSummary.topReason === "Need Example"
      ? "Work through two concrete numeric examples (one typical, one boundary case) to anchor the rule."
      : topicSummary.topReason === "Missed a Step"
      ? "Re-check the intermediate derivation step connecting inputs to the final result."
      : "Review the core definition alongside a worked diagram to verify every precondition.";

  return {
    topic: topicSummary.topic,
    peakConfusionPct: topicSummary.peakConfusionPct,
    topReason: topicSummary.topReason,
    bullets: [
      `Core Idea: Summarize "${topicSummary.topic}" in one plain sentence focusing on its input, rule, and output.`,
      `Main Bottleneck (${topicSummary.peakConfusionPct}% peak confusion): ${reasonAdvice}`,
      `Self-Test Check: Explain why each step is valid and identify at least one edge case where naive intuition fails.`,
    ],
    practiceQuestions: [
      {
        question: `When reviewing "${topicSummary.topic}", what should you verify first before applying the main rule?`,
        options: [
          "Whether the input satisfies all required preconditions and boundary cases",
          "Memorizing final numbers without checking how steps connect",
          "Skipping small test cases to save time",
        ],
        correctIndex: 0,
        explanation:
          "Checking preconditions and tracing small boundary inputs prevents the most common conceptual mistakes.",
      },
      {
        question: `If confusion spiked during "${topicSummary.topic}" (${
          topicSummary.topReason || "concept check"
        }), what is the fastest way to confirm mastery?`,
        options: [
          "Solve a fresh 3-step example from scratch and verify every intermediate state",
          "Re-read only the slide title without testing yourself",
          "Assume the first guess is right without checking constraints",
        ],
        correctIndex: 0,
        explanation:
          "Active retrieval on a fresh small example verifies real understanding rather than passive familiarity.",
      },
    ],
  };
}

