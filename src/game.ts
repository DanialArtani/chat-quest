import { broadcastOverlayEvent } from "./overlay.js";
import { curateSuggestions, type ChallengeDifficulty, type CuratedChallenge } from "./curation.js";

const SUGGESTION_WINDOW_MS = 3 * 60 * 1000;
const VOTE_WINDOW_MS = 45 * 1000;
const CHALLENGE_WINDOW_MS = 2 * 60 * 1000;
const RESULT_DISPLAY_MS = 5 * 1000;
const MAX_SUGGESTION_LENGTH = 60;
const OPTION_COUNT = 3;
const TEST_SUGGESTIONS = [
  "Do 10 push-ups",
  "Speak like a pirate for one minute",
  "Play the next round with one hand",
];

export interface TriggerUser {
  id: string;
  login: string;
  displayName: string;
}

/** The single input contract for Twitch chat, timers, and future event sources. */
export interface GameTrigger {
  source: string;
  user: TriggerUser;
  action: string;
  payload: Record<string, unknown>;
}

export type GamePhase = "suggestions" | "curating" | "voting" | "challenge" | "result";
export type ChallengeResult = "done" | "failed" | "timeout";

export interface GameOption {
  number: number;
  text: string;
  difficulty: ChallengeDifficulty;
  votes: number;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  suggestionsCount: number;
  endsAt: number | null;
  options: GameOption[];
  winner: { number: number; text: string; difficulty: ChallengeDifficulty } | null;
  result: ChallengeResult | null;
}

interface Suggestion {
  text: string;
  userId: string;
}

interface VoteOption {
  number: number;
  text: string;
  difficulty: ChallengeDifficulty;
}

const systemUser: TriggerUser = { id: "system", login: "system", displayName: "System" };

export class ChatQuestGame {
  private phase: GamePhase = "suggestions";
  private round = 0;
  private suggestions: Suggestion[] = [];
  private suggestedUsers = new Set<string>();
  private options: VoteOption[] = [];
  private votes = new Map<string, number>();
  private winner: VoteOption | null = null;
  private result: ChallengeResult | null = null;
  private endsAt: number | null = null;
  private timer: NodeJS.Timeout | undefined;
  private voteSession = 0;
  private testVoteBatch = 0;
  private curationSession = 0;

  constructor(private readonly streamerId: string) {}

  start(): void {
    this.trigger({
      source: "system",
      user: systemUser,
      action: "begin_suggestion_period",
      payload: {},
    });
  }

  /** All inputs, including scheduled game transitions, enter through this method. */
  trigger(trigger: GameTrigger): void {
    switch (trigger.action) {
      case "chat_message":
        this.routeChatCommand(trigger);
        break;
      case "submit_challenge":
        this.addSuggestion(trigger);
        break;
      case "cast_vote":
        this.castVote(trigger);
        break;
      case "start_round":
        this.startRoundNow(trigger);
        break;
      case "fill_test_suggestions":
        this.fillTestSuggestions(trigger);
        break;
      case "start_test_votes":
        this.startTestVotes(trigger);
        break;
      case "test_vote":
        if (trigger.payload.session === this.voteSession && this.phase === "voting") {
          this.trigger({ ...trigger, action: "cast_vote", payload: { option: trigger.payload.option } });
        }
        break;
      case "ai_curation_completed":
        this.finishAiCuration(trigger);
        break;
      case "ai_curation_failed":
        this.fallbackFromAiCuration(trigger);
        break;
      case "finish_challenge":
        this.finishChallenge(trigger, "done");
        break;
      case "fail_challenge":
        this.finishChallenge(trigger, "failed");
        break;
      case "begin_suggestion_period":
        this.beginSuggestionPeriod();
        break;
      case "suggestion_period_ended":
        if (this.isCurrentRound(trigger) && this.phase === "suggestions") {
          this.beginVoteOrCollectMore();
        }
        break;
      case "voting_ended":
        if (this.isCurrentRound(trigger) && this.phase === "voting") this.chooseWinner();
        break;
      case "challenge_timed_out":
        if (this.isCurrentRound(trigger) && this.phase === "challenge") {
          this.showResult("timeout");
        }
        break;
      case "result_display_ended":
        if (this.isCurrentRound(trigger) && this.phase === "result") {
          this.trigger({ source: "system", user: systemUser, action: "begin_suggestion_period", payload: {} });
        }
        break;
      default:
        console.warn(`Ignored unsupported trigger action: ${trigger.action}`);
    }
  }

  private routeChatCommand(trigger: GameTrigger): void {
    const message = typeof trigger.payload.text === "string" ? trigger.payload.text.trim() : "";
    if (!message.startsWith("!")) return;

    const [command = "", ...parts] = message.split(/\s+/);
    const argument = parts.join(" ").trim();
    switch (command.toLowerCase()) {
      case "!challenge":
        this.trigger({ ...trigger, action: "submit_challenge", payload: { text: argument } });
        break;
      case "!vote": {
        const choice = parts.length === 1 ? Number(parts[0]) : NaN;
        if (!Number.isInteger(choice) || choice < 1 || choice > OPTION_COUNT) {
          console.log(`Invalid vote from ${trigger.user.displayName}. Use !vote 1, !vote 2, or !vote 3.`);
          return;
        }
        this.trigger({ ...trigger, action: "cast_vote", payload: { option: choice } });
        break;
      }
      case "!startround":
        this.trigger({ ...trigger, action: "start_round", payload: {} });
        break;
      case "!testfill":
        this.trigger({ ...trigger, action: "fill_test_suggestions", payload: {} });
        break;
      case "!testvotes":
        this.trigger({ ...trigger, action: "start_test_votes", payload: {} });
        break;
      case "!done":
        this.trigger({ ...trigger, action: "finish_challenge", payload: {} });
        break;
      case "!fail":
        this.trigger({ ...trigger, action: "fail_challenge", payload: {} });
        break;
    }
  }

  private addSuggestion(trigger: GameTrigger): void {
    if (this.phase !== "suggestions") {
      console.log(`Challenge suggestion from ${trigger.user.displayName} ignored: suggestions are closed.`);
      return;
    }

    const text = typeof trigger.payload.text === "string" ? trigger.payload.text.trim() : "";
    const length = Array.from(text).length;
    if (length === 0) {
      console.log(`${trigger.user.displayName}: usage is !challenge <text>.`);
      return;
    }
    if (length > MAX_SUGGESTION_LENGTH) {
      console.log(`${trigger.user.displayName}: challenge suggestions must be ${MAX_SUGGESTION_LENGTH} characters or fewer.`);
      return;
    }
    if (this.suggestedUsers.has(trigger.user.id)) {
      console.log(`${trigger.user.displayName} has already suggested a challenge this round.`);
      return;
    }

    this.suggestions.push({ text, userId: trigger.user.id });
    this.suggestedUsers.add(trigger.user.id);
    console.log(`Challenge suggestion from ${trigger.user.displayName}: ${text}`);
    this.publish();
  }

  private castVote(trigger: GameTrigger): void {
    if (this.phase !== "voting") return;
    const choice = trigger.payload.option;
    if (typeof choice !== "number" || !this.options.some((option) => option.number === choice)) return;

    const previousChoice = this.votes.get(trigger.user.id);
    this.votes.set(trigger.user.id, choice);
    if (previousChoice !== choice) {
      console.log(`${trigger.user.displayName} voted for option ${choice}.`);
      this.publish();
    }
  }

  private startRoundNow(trigger: GameTrigger): void {
    if (trigger.user.id !== this.streamerId) {
      console.log(`Ignored !startround from non-streamer ${trigger.user.displayName}.`);
      return;
    }
    if (this.suggestions.length < OPTION_COUNT) {
      console.log(`!startround needs at least ${OPTION_COUNT} challenge suggestions in the current round.`);
      return;
    }
    this.beginVoting();
  }

  private fillTestSuggestions(trigger: GameTrigger): void {
    if (trigger.user.id !== this.streamerId) {
      console.log(`Ignored !testfill from non-streamer ${trigger.user.displayName}.`);
      return;
    }
    if (this.phase !== "suggestions") {
      console.log("!testfill can only be used during the suggestion period.");
      return;
    }
    for (let index = 0; index < TEST_SUGGESTIONS.length; index += 1) {
      const fakeUser: TriggerUser = {
        id: `test-suggester-${index + 1}`,
        login: `demo_viewer_${index + 1}`,
        displayName: `DemoViewer${index + 1}`,
      };
      this.trigger({
        source: "test",
        user: fakeUser,
        action: "submit_challenge",
        payload: { text: TEST_SUGGESTIONS[index]! },
      });
    }
  }

  private startTestVotes(trigger: GameTrigger): void {
    if (trigger.user.id !== this.streamerId) {
      console.log(`Ignored !testvotes from non-streamer ${trigger.user.displayName}.`);
      return;
    }
    if (this.phase !== "voting") {
      console.log("!testvotes can only be used during voting.");
      return;
    }

    const session = this.voteSession;
    const batch = ++this.testVoteBatch;
    for (let index = 0; index < 10; index += 1) {
      const fakeUser: TriggerUser = {
        id: `test-voter-${batch}-${index + 1}`,
        login: `demo_voter_${batch}_${index + 1}`,
        displayName: `DemoVoter${index + 1}`,
      };
      const option = Math.floor(Math.random() * OPTION_COUNT) + 1;
      setTimeout(() => {
        this.trigger({
          source: "test",
          user: fakeUser,
          action: "test_vote",
          payload: { session, option },
        });
      }, (index + 1) * 500);
    }
    console.log("Adding 10 random demo votes over the next 5 seconds.");
  }

  private beginSuggestionPeriod(): void {
    this.clearTimer();
    this.curationSession += 1;
    this.round += 1;
    this.phase = "suggestions";
    this.suggestions = [];
    this.suggestedUsers.clear();
    this.options = [];
    this.votes.clear();
    this.winner = null;
    this.result = null;
    this.endsAt = Date.now() + SUGGESTION_WINDOW_MS;
    this.publish();
    this.schedule("suggestion_period_ended", SUGGESTION_WINDOW_MS);
    console.log(`Round ${this.round} started. Viewers have 3 minutes to suggest challenges with !challenge <text>.`);
  }

  private beginVoteOrCollectMore(): void {
    if (this.suggestions.length < OPTION_COUNT) {
      console.log(`Round ${this.round} needs ${OPTION_COUNT} suggestions to start voting; opening another 3-minute suggestion window.`);
      this.endsAt = Date.now() + SUGGESTION_WINDOW_MS;
      this.publish();
      this.schedule("suggestion_period_ended", SUGGESTION_WINDOW_MS);
      return;
    }
    this.beginVoting();
  }

  private beginVoting(): void {
    this.clearTimer();
    const session = ++this.curationSession;
    const round = this.round;
    const suggestions = this.suggestions.map((suggestion) => suggestion.text);
    this.phase = "curating";
    this.options = [];
    this.votes.clear();
    this.winner = null;
    this.result = null;
    this.endsAt = null;
    this.publish();
    console.log(`Round ${this.round}: asking AI to review ${suggestions.length} suggestions.`);

    void curateSuggestions(suggestions)
      .then((options) => {
        this.trigger({
          source: "openai",
          user: systemUser,
          action: "ai_curation_completed",
          payload: { round, session, options },
        });
      })
      .catch((error: unknown) => {
        this.trigger({
          source: "system",
          user: systemUser,
          action: "ai_curation_failed",
          payload: { round, session, error: (error as Error).message },
        });
      });
  }

  private finishAiCuration(trigger: GameTrigger): void {
    if (!this.isCurrentCuration(trigger)) return;
    const options = trigger.payload.options as CuratedChallenge[];
    if (!Array.isArray(options) || options.length > OPTION_COUNT) {
      this.fallbackFromAiCuration({
        ...trigger,
        action: "ai_curation_failed",
        payload: { round: trigger.payload.round, session: trigger.payload.session, error: "Invalid AI curation result" },
      });
      return;
    }
    if (options.length < OPTION_COUNT) {
      console.log(`AI approved only ${options.length} safe challenge${options.length === 1 ? "" : "s"}; collecting more suggestions before voting.`);
      this.continueCollectingSuggestions();
      return;
    }
    this.openVote(options);
  }

  private fallbackFromAiCuration(trigger: GameTrigger): void {
    if (!this.isCurrentCuration(trigger)) return;
    console.warn(`AI curation failed; using raw suggestions: ${String(trigger.payload.error ?? "unknown error")}`);
    this.openVote(this.pickRawSuggestions());
  }

  private isCurrentCuration(trigger: GameTrigger): boolean {
    return this.phase === "curating"
      && trigger.payload.round === this.round
      && trigger.payload.session === this.curationSession;
  }

  private continueCollectingSuggestions(): void {
    this.phase = "suggestions";
    this.options = [];
    this.endsAt = Date.now() + SUGGESTION_WINDOW_MS;
    this.publish();
    this.schedule("suggestion_period_ended", SUGGESTION_WINDOW_MS);
  }

  private pickRawSuggestions(): VoteOption[] {
    const candidates = [...this.suggestions];
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex]!, candidates[index]!];
    }
    return candidates.slice(0, OPTION_COUNT).map((suggestion, index) => ({
      number: index + 1,
      text: suggestion.text,
      difficulty: "unrated",
    }));
  }

  private openVote(options: VoteOption[] | CuratedChallenge[]): void {
    this.clearTimer();
    this.voteSession += 1;
    this.options = options.map((option, index) => ({ ...option, number: index + 1 }));
    this.phase = "voting";
    this.votes.clear();
    this.winner = null;
    this.result = null;
    this.endsAt = Date.now() + VOTE_WINDOW_MS;
    this.publish();
    this.schedule("voting_ended", VOTE_WINDOW_MS);
    console.log(`Round ${this.round}: voting is open for 45 seconds. Viewers can use !vote 1, !vote 2, or !vote 3.`);
  }

  private chooseWinner(): void {
    this.clearTimer();
    const counts = new Map<number, number>(this.options.map((option) => [option.number, 0] as const));
    for (const choice of this.votes.values()) counts.set(choice, (counts.get(choice) ?? 0) + 1);
    const highestCount = Math.max(...counts.values());
    const tied = this.options.filter((option) => counts.get(option.number) === highestCount);
    const winner = tied[Math.floor(Math.random() * tied.length)] ?? this.options[0];
    if (!winner) {
      this.trigger({ source: "system", user: systemUser, action: "begin_suggestion_period", payload: {} });
      return;
    }

    this.winner = winner;
    this.phase = "challenge";
    this.endsAt = Date.now() + CHALLENGE_WINDOW_MS;
    this.publish();
    this.schedule("challenge_timed_out", CHALLENGE_WINDOW_MS);
    console.log(`Challenge started: ${winner.text}. Streamer can use !done or !fail.`);
  }

  private finishChallenge(trigger: GameTrigger, result: Exclude<ChallengeResult, "timeout">): void {
    if (trigger.user.id !== this.streamerId) {
      console.log(`Ignored ${result === "done" ? "!done" : "!fail"} from non-streamer ${trigger.user.displayName}.`);
      return;
    }
    if (this.phase !== "challenge") return;
    this.showResult(result);
  }

  private showResult(result: ChallengeResult): void {
    this.clearTimer();
    this.phase = "result";
    this.endsAt = Date.now() + RESULT_DISPLAY_MS;
    this.result = result;
    this.publish();
    this.schedule("result_display_ended", RESULT_DISPLAY_MS);
    const outcome = result === "done" ? "completed" : result === "failed" ? "failed" : "timed out";
    console.log(`Challenge ${outcome}.`);
  }

  private isCurrentRound(trigger: GameTrigger): boolean {
    return trigger.payload.round === this.round;
  }

  private schedule(action: string, duration: number): void {
    const round = this.round;
    this.timer = setTimeout(() => {
      this.trigger({ source: "system", user: systemUser, action, payload: { round } });
    }, duration);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private getState(): GameState {
    return {
      phase: this.phase,
      round: this.round,
      suggestionsCount: this.suggestions.length,
      endsAt: this.endsAt,
      options: this.options.map((option) => ({
        ...option,
        votes: [...this.votes.values()].filter((choice) => choice === option.number).length,
      })),
      winner: this.winner ? { ...this.winner } : null,
      result: this.result,
    };
  }

  private publish(): void {
    broadcastOverlayEvent({ type: "game_state", state: this.getState() });
  }
}
