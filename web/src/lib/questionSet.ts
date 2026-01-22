export type Choice = {
  id: string;
  text: string;
};

export type Question = {
  id: string;
  text: string;
  choices: Choice[];
  answer_choice_ids?: string[] | null;
  is_multi_select?: boolean | null;
  explanation?: string | null;
  tags?: string[] | null;
};

export type QuestionSet = {
  set_id: string;
  title: string;
  questions: Question[];
};

export class QuestionSetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionSetFormatError";
  }
}

function requireField(obj: Record<string, unknown>, key: string): unknown {
  if (!(key in obj)) throw new QuestionSetFormatError(`missing required field: ${key}`);
  return obj[key];
}

function asNonEmptyString(x: unknown, field: string): string {
  if (typeof x !== "string" || x.trim().length === 0) {
    throw new QuestionSetFormatError(`${field} must be a non-empty string`);
  }
  return x;
}

function asOptionalString(x: unknown, field: string): string | null | undefined {
  if (x === undefined) return undefined;
  if (x === null) return null;
  if (typeof x !== "string") throw new QuestionSetFormatError(`${field} must be a string or null`);
  const s = x.trim();
  return s.length ? s : null;
}

function asOptionalStringList(x: unknown, field: string): string[] | null | undefined {
  if (x === undefined) return undefined;
  if (x === null) return null;
  if (!Array.isArray(x) || !x.every((i) => typeof i === "string")) {
    throw new QuestionSetFormatError(`${field} must be a list of strings or null`);
  }
  const out = x.map((i) => i.trim()).filter(Boolean);
  return out.length ? out : null;
}

function asOptionalBoolean(x: unknown, field: string): boolean | null | undefined {
  if (x === undefined) return undefined;
  if (x === null) return null;
  if (typeof x !== "boolean") throw new QuestionSetFormatError(`${field} must be a boolean or null`);
  return x;
}

export function parseQuestionSet(obj: unknown): QuestionSet {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new QuestionSetFormatError("root must be an object");
  }
  const root = obj as Record<string, unknown>;

  const set_id = asNonEmptyString(requireField(root, "set_id"), "set_id");
  const title = asNonEmptyString((root.title as unknown) ?? set_id, "title");

  const questionsRaw = requireField(root, "questions");
  if (!Array.isArray(questionsRaw)) throw new QuestionSetFormatError("questions must be a list");

  const seenQids = new Set<string>();
  const questions: Question[] = questionsRaw.map((q, idx0) => {
    const i = idx0 + 1;
    if (typeof q !== "object" || q === null || Array.isArray(q)) {
      throw new QuestionSetFormatError(`questions[${i}] must be an object`);
    }
    const qObj = q as Record<string, unknown>;

    const qid = asNonEmptyString(requireField(qObj, "id"), `questions[${i}].id`);
    if (seenQids.has(qid)) throw new QuestionSetFormatError(`duplicate question id: ${qid}`);
    seenQids.add(qid);

    const text = asNonEmptyString(requireField(qObj, "text"), `questions[${i}].text`);

    const choicesRaw = requireField(qObj, "choices");
    if (!Array.isArray(choicesRaw) || choicesRaw.length === 0) {
      throw new QuestionSetFormatError(`questions[${i}].choices must be a non-empty list`);
    }

    const seenCids = new Set<string>();
    const choices: Choice[] = choicesRaw.map((c, idx1) => {
      const j = idx1 + 1;
      if (typeof c !== "object" || c === null || Array.isArray(c)) {
        throw new QuestionSetFormatError(`questions[${i}].choices[${j}] must be an object`);
      }
      const cObj = c as Record<string, unknown>;
      const cid = asNonEmptyString(
        requireField(cObj, "id"),
        `questions[${i}].choices[${j}].id`,
      );
      if (seenCids.has(cid)) throw new QuestionSetFormatError(`duplicate choice id in question ${qid}: ${cid}`);
      seenCids.add(cid);
      const ctext = asNonEmptyString(
        requireField(cObj, "text"),
        `questions[${i}].choices[${j}].text`,
      );
      return { id: cid, text: ctext };
    });

    const answer_choice_ids = asOptionalStringList(
      qObj.answer_choice_ids,
      `questions[${i}].answer_choice_ids`,
    );
    if (answer_choice_ids && answer_choice_ids.length) {
      const unknown = answer_choice_ids.filter((cid) => !seenCids.has(cid));
      if (unknown.length) {
        throw new QuestionSetFormatError(
          `questions[${i}].answer_choice_ids contains unknown choice ids: ${unknown.join(", ")}`,
        );
      }
    }

    const is_multi_select = asOptionalBoolean(qObj.is_multi_select, `questions[${i}].is_multi_select`);
    const explanation = asOptionalString(qObj.explanation, `questions[${i}].explanation`);
    const tags = asOptionalStringList(qObj.tags, `questions[${i}].tags`);

    return {
      id: qid,
      text,
      choices,
      answer_choice_ids: answer_choice_ids ?? undefined,
      is_multi_select: is_multi_select ?? undefined,
      explanation: explanation ?? undefined,
      tags: tags ?? undefined,
    };
  });

  return { set_id, title, questions };
}

export function loadQuestionSetFromJsonText(jsonText: string): QuestionSet {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch (e) {
    throw new QuestionSetFormatError(`failed to parse JSON: ${String(e)}`);
  }
  return parseQuestionSet(obj);
}
