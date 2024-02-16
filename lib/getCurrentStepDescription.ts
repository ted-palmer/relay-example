import { Execute } from '@reservoir0x/relay-sdk'

/**
 * Finds the description of the current step in a sequence of steps based on the item completion status
 *
 * @param {Array} steps - The array of steps in the process.
 * @returns {String} The description of the current step
 */
export function getCurrentStepDescription(steps: Execute['steps']) {
  for (let step of steps) {
    if (step.items) {
      const hasIncompleteItem = step.items.some(
        (item) => item.status === 'incomplete'
      )

      if (hasIncompleteItem) {
        return step.description
      }
    }
  }
}
