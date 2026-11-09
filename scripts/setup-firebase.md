# Setting up the Firebase project without the console

What the console's "Add project" and "AI Logic > Get started" do, as API calls. Every call
needs an OAuth token for the account that owns the project:
`T=$(gcloud auth print-access-token --account=you@example.com)`, sent as
`Authorization: Bearer $T` with `x-goog-user-project: $P`. In zsh, write `${P}:addFirebase`,
not `$P:addFirebase`, or the shell treats `:a` as a modifier.

```bash
P=your-project-id
gcloud projects create $P --name="Second Look"
gcloud services enable firebase.googleapis.com firebasehosting.googleapis.com \
  firebaseappcheck.googleapis.com firebasevertexai.googleapis.com \
  generativelanguage.googleapis.com apikeys.googleapis.com --project=$P

# Firebase on the project (wait a minute after creating it, while IAM propagates)
curl -X POST "https://firebase.googleapis.com/v1beta1/projects/${P}:addFirebase" -d '{}' ...

# A web app, and its config for .env.local
curl -X POST "https://firebase.googleapis.com/v1beta1/projects/${P}/webApps" -d '{"displayName": "Second Look web"}' ...
curl "https://firebase.googleapis.com/v1beta1/projects/${P}/webApps/<APP_ID>/config" ...
```

Firebase AI Logic with the Gemini Developer API keeps a Gemini API key on the server. Create
one restricted to the Generative Language API and store it in the AI Logic config (until this
exists, requests fail with "Firebase AI Logic genai config not found"):

```bash
gcloud services api-keys create --display-name="Gemini Developer API key" \
  --api-target=service=generativelanguage.googleapis.com --project=$P
KEY=$(gcloud services api-keys get-key-string <KEY_RESOURCE_NAME> --format="value(keyString)")
curl -X PATCH "https://firebasevertexai.googleapis.com/v1beta/projects/${P}/locations/global/config?updateMask=generativeLanguageConfig.apiKey" \
  -d "{\"generativeLanguageConfig\": {\"apiKey\": \"$KEY\"}}" ...
```

The Firebase browser key that comes with the web app already allows
`firebasevertexai.googleapis.com`. Never put the Gemini key itself in the app.
