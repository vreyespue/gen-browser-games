Me: the character does not jump, can you fix it?
Copilot: Fix the character jump by ensuring the jump only occurs when the player is on the ground.

commit
git commit -m 'copilot fixes character should jump only when on the ground'

Me: there is still a problem, i.e. the character does not jump at all
Copilot: Fix the character jump by ensuring the jump only occurs when the player is on the ground and the ArrowUp key is pressed.

Note: it does not understand that the jumping should be applied after avoiding the falling. At least not on its own.
