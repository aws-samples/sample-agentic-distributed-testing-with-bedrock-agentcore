// Downloadable / copyable examples shown in the Import and Generate-from-spec dialogs.

/** A small, valid test-suite file — what Import expects. One feature with a Background and two scenarios. */
export const IMPORT_TEMPLATE_YAML = `# Test suite template — fill it in, then use Import to load it.
#
# features:      one or more groups of related scenarios
#   name         the feature's name (required)
#   description  its Background: setup shared by EVERY scenario in it, as plain
#                Given / And lines (optional)
#   testCases    the scenarios
#     id         optional: TC001, TC002, ... (missing ids are assigned for you)
#     scenario   what the scenario proves, in one line (required)
#     given      starting context specific to this scenario
#     when       what the user does — goals are fine, no exact buttons needed
#     then       what should be true afterwards — judged by meaning, not wording
#
# Don't write the app's URL or any username/password in test cases. Say "the target URL" and
# "Login with Regular User credentials" / "Login with Admin credentials"; the real values come
# from the Target URL field and the Authentication button when the tests run.
#
# Importing REPLACES the current test suite, so Export first if you want a backup.
targetUrl: http://localhost:8020
features:
  - name: Sign-on
    description: |
      Given the application is running
      And no one is signed in
    testCases:
      - id: TC001
        scenario: Valid user signs in and reaches the main menu
        given:
          - Regular User credentials are available
        when:
          - Navigate to the target URL
          - Login with Regular User credentials
        then:
          - I see the main menu
      - id: TC002
        scenario: Wrong password is rejected
        given:
          - Regular User credentials are available
        when:
          - Navigate to the target URL
          - Enter the Regular User's User ID and a wrong password
        then:
          - I stay on the sign-on screen
          - I see "Wrong Password. Try again ..."
`

/** An example spec in user-story form — shown in the Generate dialog and downloadable. */
export const SAMPLE_SPEC = `# Bill Payment

As a signed-in cardholder
I want to pay the full balance on my credit card account
So that I stay current and avoid interest

Acceptance criteria
1. The Bill Payment screen asks for the Account ID and shows the current balance.
2. Paying requires a confirmation (Y/N) before anything is posted.
3. If the balance is zero or negative, the message "You do not have any balance to pay" is shown and nothing is posted.
4. On success the balance becomes 0.00 and a transaction id is shown.
5. An unknown Account ID shows "Account ID NOT found".
`

/** Save text as a file in the browser. */
export function downloadText(filename, text, type = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
