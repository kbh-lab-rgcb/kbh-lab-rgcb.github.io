# How to update the website

You do not need to install anything, and you do not need to know any code.
Everything on the site comes from files in the [`content/`](content/) folder, and
you can change them from your browser.

After you save a change, the site rebuilds itself and goes live in about two
minutes.

---

## The one rule worth learning

**A photo and its text file share the same name.**

```text
content/pages/04-team/photos/04-anna-t-varghese.jpg
content/pages/04-team/text/04-anna-t-varghese.txt
```

Same name, different folder. That is how the site knows which text belongs to
which photo. The `04-` at the front controls the order and is not shown to
visitors.

The same idea is used everywhere: figures pair with text sections, gallery
captions pair with gallery photos.

---

## Editing text from your browser

1. Go to the file on GitHub — for example
   `content/pages/02-research/text/01-overview.txt`.
2. Click the **pencil** icon (top right of the file).
3. Make your changes.
4. Scroll down, type a short note about what you changed, and click
   **Commit changes**.

That is it. Wait a couple of minutes and refresh the website.

## Uploading a photo

1. Open the folder you want to add to — for example
   `content/pages/07-gallery/photos/`.
2. Click **Add file → Upload files**.
3. Drag your photos in.
4. Click **Commit changes**.

Upload the full-size original. Photos are resized automatically, so you do not
need to shrink them first.

## Creating a new file

1. Open the folder.
2. Click **Add file → Create new file**.
3. Type the filename, including `.txt` — for example `08-new-member.txt`.
4. Type the contents.
5. Click **Commit changes**.

---

## Common jobs

### Add a new lab member

Two files, same name:

- Upload their photo to `content/pages/04-team/photos/` as, say,
  `08-new-person.jpg`
- Create `content/pages/04-team/text/08-new-person.txt` containing:

```text
name: New Person
role: PhD Student
email: newperson@rgcb.res.in
focus: What they work on, in one line

A short paragraph about their background and research.
```

**You can do these in either order.** A photo with no text file still shows the
person, and a text file with no photo shows their initials. Nothing breaks
halfway through.

### Add your ORCID, Google Scholar or ResearchGate

Add a line to your own text file:

```text
orcid: 0000-0002-1825-0097
scholar: https://scholar.google.com/citations?user=YOURID
researchgate: Your-Profile-Name
```

A small button appears on your card. **If you leave a line out, nothing shows —
no empty space.** Nobody else's card is affected.

Two things that make this hard to get wrong:

- You can paste the **full web address or just the ID** — both end up in the
  right place.
- The line works **at the top with the other settings or at the bottom under
  your biography**. Adding it wherever you happen to be typing is fine.

### Give someone a page of their own

Add one line to their file in `content/pages/04-team/text/`:

```text
profile: yes
```

Their photo and name on the team page become links to a page about just them.
Everything you write under a `## Heading` in that same file goes on it —
education, previous positions, awards, conferences, whatever you name a heading
after. Everything **above** the first heading stays on their card.

```text
name: Your Name
role: PhD Student
profile: yes

A short paragraph. This is what the team page shows.

## Education

PhD Biochemistry, 2024 — Rajiv Gandhi Centre for Biotechnology

## Awards

2015 — Travel award, ASBMB annual meeting, Washington D.C.
```

A line written as **`term — detail`** becomes a two-column row. Papers on the
publications page that list that person as an author appear on their page by
themselves — there is no second list to maintain.

Papers the lab list does **not** carry — earlier work from another laboratory, a
preprint — can go on their page alone. Either give the DOI:

```text
papers: 10.5555/their.paper.2019
```

or paste the full citation under a `## Publications` heading in their own file,
one per paragraph, and it is listed properly with its DOI and PubMed buttons.
The alumni page works the same way.

`content/pages/04-team/text/README.md` explains every part of this.

### Add a research story

A research story is a longer piece about one line of work, with the papers
behind it. It appears in full on the **Research stories** page **and as a card
on the home page** — you only write it once.

Create a file in `content/pages/03-stories/stories/`, named with the next
number, such as `05-my-new-story.txt`:

```text
title: The headline, written as a sentence
tag: Topic · Second topic
lead: One sentence saying what the work found.
why: Why it matters, in a sentence or two.
excerpt: The short version, used on the home page card.
papers: 10.3390/biom11050661

The background research, in paragraphs.
```

You give the **DOI** of each paper, not the citation — the site prints the
citation from the publications page, so it is written out once and stays in
step. Add the paper there first.

Every line except the story itself is optional; leave one out and that part is
simply not shown. `content/pages/03-stories/stories/README.md` explains each
line in full.

Give the story a picture by putting it in `content/pages/03-stories/figures/`
under the same name — `05-my-new-story.jpg`. It appears beside the story, and
behind that story's card on the home page.

### Add a photo album

A folder inside the gallery's `photos/` folder becomes an album — shown as a
little stack of prints that opens when a visitor clicks it.

1. Open `content/pages/07-gallery/photos/`.
2. Click **Add file → Upload files**.
3. Drag a *folder* of photos in — GitHub keeps the folder — or drag photos in
   after typing a folder name into the file path box.
4. Click **Commit changes**.

The folder name becomes the album title: `christmas-2026` shows as "Christmas
2026", and a `01-` in front puts it first. Photos left loose in `photos/` still
appear, under **More photos** below the albums.

To give the album a proper title, a date line, a description or a chosen cover
photo, add a file called `album.txt` **inside the album folder**:

```text
title: Christmas 2026
date: December 2026
cover: 04-cake.jpg
caption: Secret Santa, cake, and the annual group photo.
```

Every line is optional. Captions for photos in an album go next to the photo in
the same folder — `02-tree.jpg` is captioned by `02-tree.txt`.

### Add a publication

Open `content/pages/06-publications/years/` and edit the file for that year, or
create it (`2026.txt`). Paste the citation, leaving a blank line between papers,
and add the identifier at the end:

```text
Author A, Author B, Harikumar KB. Title of the paper. Journal Name.
2026;12(3):45-67. pmid:12345678 doi:10.1234/example
```

The DOI and PubMed buttons appear on their own. If you do not have an
identifier, leave it out — the paper still lists, just without a button.

**Which folder?** `years/` is for papers with **a lab member among the authors**
— current people or alumni. Everything else the PI has published goes in
`content/pages/06-publications/pi/`: his doctoral and post-doctoral work, and
studies he has guided or co-authored in someone else's group.

Both lists appear on the Publications page — the lab's own first, the rest in a
panel below it that opens with a click. **The number on the home page counts
`years/` only.** To move a paper from one list to the other, cut the paragraph
and paste it into the file for the same year in the other folder.

### Share a code file or a repository

Everything lives under `content/pages/10-resources/`, and **one folder is one
entry**:

```
10-resources/
  1-repositories/
    1.1-lab-website/
      item.txt
  2-code-blocks/
    2.1-volcano-plot/
      item.txt
      volcano_plot.R
```

To add a new one, create a folder in the branch it belongs to — say
`2-code-blocks/2.3-pca-script/` — put your script in it, and write an `item.txt`
beside it:

```text
title: PCA of expression data
language: R
summary: One line, shown on the card.

A paragraph on what it does.

## Requirements

R — 4.2 or newer
ggplot2 — draws the plot

## How to run it

Whatever someone needs to type, in the order they need to type it.
```

That is all. The card, the page and the download button follow from the folder
being there.

- **Every file in the folder becomes a download**, under its own name. Scripts
  and notebooks are also shown on the page so people can read them first.
- **A code block can point at a repository too** — add `repo: owner/name` and a
  button appears next to the files.
- **Numbering.** `1.1-`, `2.3-`: the first number is the branch, the second is
  the position in it. Plain `01-` works the same way.
- **A new branch** is just another folder — `3-datasets/` with a `group.txt`
  becomes a third heading on the page.

Longer notes are in `content/pages/10-resources/README.md`.

### Change a page's banner

Put an image in that page's `banner/` folder. One image gives a still banner;
**two or more turn into a slideshow automatically.**

### Move a page in the menu

Rename its folder. `05-publications` → `02-publications` moves it up.

### Add a whole new page

Create a folder under `content/pages/`, such as `09-facilities`, with a
`banner/` folder and a `text/` folder inside. The page and its menu link appear
on their own.

---

## If something looks wrong

**The site will not break because of a content mistake.** Missing files, empty
files and unmatched photos all produce a sensible fallback rather than an error.

To see what the site made of your files, open the **Actions** tab on GitHub and
look at the most recent run. Anything it could not use is listed there, with the
file name and what it did instead.

If the page still looks wrong after two minutes, check that:

- the filename matches its partner exactly (including the `04-` prefix)
- the file ends in `.txt`, not `.txt.txt` or `.docx`
- there is a **blank line** between the `key: value` lines and the body text

---

## Previewing on your own computer (optional)

Only needed if you want to see changes before they go live.

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. Edit any file in `content/` and the page
reloads by itself.

To see a report of what the site can and cannot read from your files:

```bash
npm run check
```
