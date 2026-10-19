export const problem = {
  id: "best-streak",
  version: 1,
  title: "Best streak",
  difficulty: "Easy",
  topic: "Arrays",
  durationMinutes: 30,
  description:
    "A learning app records your daily progress as positive and negative points. Find the highest total score you can earn from a non-empty, consecutive stretch of days.",
  input:
    "The first line contains n, the number of days. The second line contains n space-separated integers: the daily points.",
  output:
    "Print one integer: the maximum sum of any non-empty contiguous subarray.",
  constraints: [
    "1 ≤ n ≤ 100,000",
    "−10,000 ≤ points[i] ≤ 10,000",
    "The chosen stretch must contain at least one day.",
  ],
  starter:
    'import sys\n\ndef solve():\n    n = int(sys.stdin.readline())\n    points = list(map(int, sys.stdin.readline().split()))\n\n    # Find the best non-empty consecutive stretch.\n    \n\nif __name__ == "__main__":\n    solve()\n',
  examples: [
    {
      input: "9\n-2 1 -3 4 -1 2 1 -5 4\n",
      output: "6\n",
      explanation: "The stretch [4, −1, 2, 1] has a total of 6.",
    },
    {
      input: "3\n-8 -3 -6\n",
      output: "-3\n",
      explanation:
        "Choose the single day with −3 points. An empty stretch is not allowed.",
    },
  ],
};
// This module is server-only. Never import it into the web bundle.
export const hiddenTests = [
  { input: "1\n7\n", output: "7\n" },
  { input: "1\n-7\n", output: "-7\n" },
  { input: "5\n0 0 0 0 0\n", output: "0\n" },
  { input: "4\n1 2 3 4\n", output: "10\n" },
  { input: "5\n-5 -2 -9 -1 -3\n", output: "-1\n" },
  { input: "7\n5 -10 3 4 -1 2 -20\n", output: "8\n" },
  { input: "5\n4 -1 -2 -3 8\n", output: "8\n" },
  {
    input: `100000\n${Array(100000).fill("10000").join(" ")}\n`,
    output: "1000000000\n",
  },
];
