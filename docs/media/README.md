# Media referenced by the root README

**The README currently has its media block commented out**, because broken image icons
look worse than no images at all. Drop the files here under **exactly** these names, then
uncomment that block in `README.md` — it is marked `SCREENSHOTS AND VIDEO GO HERE` and
already contains the finished markup and captions.

| File | What it should show |
| --- | --- |
| `world.png` | The hero shot: the world from above, several devots, the terrain and the fog |
| `creation.png` | The creation screen — look, stats, traits, soul |
| `mind.png` | The Mind panel, with a devot's journal and inner monologue |
| `combat.png` | A fight in progress: the beam, the numbers, the flash |
| `wallet.png` | MetaMask asking to confirm the 0G deposit |
| `demo.mp4` | The demo video |

GitHub will not play an `.mp4` inline from a relative link — it renders as a download
link, which is what the README currently does. To get an inline player instead, drag the
video into any GitHub issue comment, copy the `user-images.githubusercontent.com` URL it
produces, and use that URL in the README.

Keep screenshots under about 2 MB each; the repository is cloned by anyone who wants to
run the world.

---

## Ready-to-paste block

Once the files are here, paste this into `README.md` in place of the one-line
comment under `## The world`:

````markdown
![The world of Devot](docs/media/world.png)

<table>
  <tr>
    <td width="50%"><img src="docs/media/creation.png" alt="The creation screen"><br><em>Shaping a founder: look, stats, traits and soul, inside one point budget the server re-checks.</em></td>
    <td width="50%"><img src="docs/media/mind.png" alt="The Mind panel"><br><em>The Mind panel: every thought a devot has ever had, and what each one cost it.</em></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/media/combat.png" alt="Combat"><br><em>Predation: life transferred from victim to attacker, in full view.</em></td>
    <td width="50%"><img src="docs/media/wallet.png" alt="Paying the deposit"><br><em>The birth deposit, signed by the player in their own wallet on 0G Galileo.</em></td>
  </tr>
</table>

**▶ [Watch the demo](docs/media/demo.mp4)**
````
