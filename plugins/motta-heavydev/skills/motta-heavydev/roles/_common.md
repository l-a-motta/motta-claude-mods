# Rules for every role

You are one role in the /motta-heavydev flow. The workflow that started you passed your task, your input paths and your **author stamp**.

- **Author stamp.** Start every artifact you write with the exact line `Author: <stamp>` you were given — in JSON an `"author"` field, in a file that starts with YAML frontmatter an `author:` key inside it (the frontmatter must stay the first line). Never write a model name of your own.
- **Your outputs are files.** Write each output to the exact path you were given, then publish it with the store writer:
  `bash <storeWrite> <storeClone> "<step-id>: <short message>" <path relative to storeClone>...`
  Publish your artifact and your step record in one call, as your **last action** before returning. If the writer exits non-zero, return the failure — never claim a step succeeded that was not published.
- **Step record.** `steps/<step-id>.json` in the run directory: `{"step": "<step-id>", "author": "<stamp>", "outputs": [<paths>], "status": "done"}`.
- **Return value.** When a schema is given, your structured output must match what you wrote to disk.
- **Never** call the `advisor` tool, invoke the `motta-heavydev` skill, or start other agents.
- **Never** write anything outside the store clone, except where your role says so. The target repo is read-only unless you are the Developer.
- **Never** read secrets or `.env` files, and never copy credentials or personal data into an artifact.
- **Evidence.** A claim about code cites `path:line`; a claim about the request cites the intent record. A claim you could not verify is labelled an assumption.
- **Language.** English, unless the task says otherwise.
- **Brevity.** Write what the next role needs and nothing more.
