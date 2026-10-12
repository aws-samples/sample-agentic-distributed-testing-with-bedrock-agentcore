import Modal from './Modal'
import Btn from './Btn'
import styles from './BddHelpModal.module.css'

const EXAMPLE = `Scenario: Customer pays the full card balance
  Given I am a signed-in customer with a credit card account
  When I pay the full balance on my card
  Then I see a payment confirmation
  And the balance shows as zero`

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
            <tr><td className={styles.kw}>And</td><td>Adds another step to the one above it, in the same section. <span className={styles.eg}>the balance shows as zero</span></td></tr>
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
          <li><strong>Keep exact values when they matter</strong>: amounts, IDs and codes, credentials, or a message that is the point of the test.</li>
          <li>If a line is genuinely unclear, the agent picks the most reasonable reading and says which one it used in its verdict.</li>
        </ul>

        <div className={styles.h}>Format rules</div>
        <ul>
          <li><strong>Editor</strong> tab: one row per step. Press Enter for the next step, and use the arrows to reorder.</li>
          <li><strong>Gherkin</strong> tab: the same scenario as raw text. Start with <code>Scenario:</code>, then lines starting with <code>Given</code>, <code>When</code>, <code>Then</code>, <code>And</code> or <code>But</code>.</li>
          <li>One scenario per test case. Add more test cases instead of more scenarios.</li>
          <li>Steps are kept in Given → When → Then order.</li>
          <li><strong>Enhance by AI</strong> rewrites a detailed test case into this style and lets you compare before saving.</li>
        </ul>
      </div>
    </Modal>
  )
}
