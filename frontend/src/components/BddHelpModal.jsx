import Modal from './Modal'
import Btn from './Btn'
import styles from './BddHelpModal.module.css'

const EXAMPLE = `Scenario: Customer pays the full card balance

Given:
  - I am a signed-in customer with a credit card account
When:
  - I pay the full balance on my card
Then:
  - I see a payment confirmation
  - the balance shows as zero`

export default function BddHelpModal({ open, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How test cases are written (BDD)"
      width="min(680px, 94vw)"
      footer={<Btn variant="primary" onClick={onClose}>Got it</Btn>}
    >
      <div className={styles.body}>
        <p>
          <strong>BDD (Behaviour-Driven Development)</strong> describes a test as a short story in plain language:
          where you start, what you do, and what you expect to see. Each test case is one <strong>Scenario</strong>.
        </p>

        <table className={styles.table}>
          <tbody>
            <tr><td className={styles.kw}>Given</td><td>The starting situation. <span className={styles.eg}>I'm a signed-in customer with a credit card account</span></td></tr>
            <tr><td className={styles.kw}>When</td><td>What the user does. <span className={styles.eg}>I pay the full balance on my card</span></td></tr>
            <tr><td className={styles.kw}>Then</td><td>What should be true afterwards. <span className={styles.eg}>I see a payment confirmation</span></td></tr>
            <tr><td className={styles.kw}>- step</td><td>Each step is one line starting with a dash. Add as many as you need under a header. <span className={styles.eg}>the balance shows as zero</span></td></tr>
          </tbody>
        </table>

        <div className={styles.h}>Example</div>
        <pre className={styles.code}>{EXAMPLE}</pre>

        <div className={styles.h}>AI-enhanced BDD: some ambiguity is intended</div>
        <p>
          Classic BDD needs every line to match a pre-written step definition. Here an AI agent drives a real browser
          and works out the clicks itself, so you can write <em>what</em> you want, not <em>how</em>:
        </p>
        <ul>
          <li>Say <em>"I pay the full balance"</em>, not <em>"click the Pay button, choose Full, press Submit"</em>.</li>
          <li>Say <em>"it looks like a retro terminal"</em> instead of listing colours and fonts. Outcomes are judged by meaning, not exact wording.</li>
          <li><strong>Keep exact values when they matter</strong>: amounts, IDs and codes, or a message that is the point of the test.</li>
          <li>If a line is genuinely unclear, the agent picks the most reasonable reading and says which one it used in its verdict.</li>
        </ul>

        <div className={styles.h}>The app's address and logins</div>
        <p>
          Every run sends the agent the <strong>Target URL</strong> and the accounts from <strong>Authentication</strong>.
          Refer to them with these phrases instead of writing the real values:
        </p>
        <table className={styles.table}>
          <tbody>
            <tr><td className={`${styles.kw} ${styles.phrase}`}>the target URL</td><td>The app under test. <span className={styles.eg}>I open the target URL</span></td></tr>
            <tr><td className={`${styles.kw} ${styles.phrase}`}>Login with Regular User credentials</td><td>Sign in with the regular-user account (a When step).</td></tr>
            <tr><td className={`${styles.kw} ${styles.phrase}`}>Login with Admin credentials</td><td>Sign in with the admin account (a When step).</td></tr>
            <tr><td className={`${styles.kw} ${styles.phrase}`}>Logged in with …</td><td>For a Given: start already signed in. <span className={styles.eg}>Logged in with Admin credentials</span></td></tr>
          </tbody>
        </table>
        <p className={styles.warn}>
          <strong>Never type a URL, username or password into a step.</strong> Test cases are saved and exported as plain text.
          The one exception is a wrong-password or unknown-user test, which may write the bad value it tests with.
        </p>

        <div className={styles.h}>Format rules</div>
        <ul>
          <li><strong>Editor</strong> tab: one row per step. Press Enter for the next step, and use the arrows to reorder.</li>
          <li><strong>Gherkin</strong> tab: the same scenario as text, laid out like YAML. Start with <code>Scenario:</code>, then a <code>Given:</code>, <code>When:</code> and <code>Then:</code> header, each followed by its steps as an indented <code>- </code> list. Classic Gherkin (<code>Given …</code> / <code>And …</code> lines) pasted in is understood and tidied into this layout.</li>
          <li>One scenario per test case. Add more test cases instead of more scenarios.</li>
          <li>Steps are kept in Given → When → Then order.</li>
          <li><strong>Edit with AI</strong> changes an existing test case the way you ask (or from a preset such as Formatting or More ambiguous) and lets you compare before saving. It calls the AI (Amazon Bedrock).</li>
          <li>The <strong>+</strong> on a feature offers <strong>Blank scenario</strong> (an empty test case you write yourself, no AI call) and <strong>Draft with AI (uses Bedrock)</strong>, which uses the same box (without the presets) to draft a new test case from a short description.</li>
          <li><strong>Duplicate</strong> copies a test case into the same feature, right after it, as a starting point for a variation.</li>
        </ul>
      </div>
    </Modal>
  )
}
