#!/usr/bin/env python3
"""Builds the plan import fixtures in this folder (KRB-196).

Run it from anywhere: python3 tests/fixtures/plans/make-fixtures.py
Standard library only. Every ZIP entry has a fixed date, so the files come
out the same on every run.

- tdr-titres.docx: terms of reference as French Word writes them. Its
  heading styles have the ids "Titre1" and "Titre2" and the built-in names
  "heading 1" and "heading 2". A "Titre" (Title) paragraph on top, text
  under each heading, a numbered list in the text and a footnote.
- tdr-styles-nommes.docx: headings in styles really named "Titre 1" and
  "Titre 2", as French templates and LibreOffice name them.
- tdr-numerote.docx: no heading style. Typed numbers "I.", "A." and "1.",
  and a numbered list in the text that restarts at 1.
- tdr.md: Markdown with "##" and "###" under a "#" title.
- tdr.txt: plain text with "1." and "1.1" numbers, in Windows-1252.
- tdr.pdf: two pages of text with "1." and "1.1" numbers, Helvetica.
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
FIXED_DATE = (1980, 1, 1, 0, 0, 0)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
RELS = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def write_zip(path: Path, files: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in files:
            info = zipfile.ZipInfo(name, date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0
            info.external_attr = 0
            archive.writestr(info, data, compresslevel=9)


def run(text: str, props: str = "") -> str:
    rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def paragraph(content: str, ppr: str = "") -> str:
    return f"<w:p>{f'<w:pPr>{ppr}</w:pPr>' if ppr else ''}{content}</w:p>"


def text(value: str) -> str:
    return paragraph(run(value))


def styled(style: str, value: str) -> str:
    return paragraph(run(value), f'<w:pStyle w:val="{style}"/>')


def list_item(num_id: int, level: int, value: str) -> str:
    return paragraph(run(value), f'<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num_id}"/></w:numPr>')


def style(style_id: str, name: str) -> str:
    return (
        f'<w:style w:type="paragraph" w:styleId="{style_id}"><w:name w:val="{name}"/>'
        '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/></w:style>'
    )


NUMBERING = (
    f'<w:numbering xmlns:w="{W}">'
    '<w:abstractNum w:abstractNumId="0">'
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
    "</w:abstractNum>"
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    "</w:numbering>"
)

FOOTNOTES = (
    f'<w:footnotes xmlns:w="{W}">'
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
    '<w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">Décret n° 2024-12 du 3 janvier 2024.</w:t></w:r></w:p></w:footnote>'
    "</w:footnotes>"
)


def docx(path: Path, body: str, styles: str, with_notes: bool = False) -> None:
    content_types = (
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        + (
            '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
            if with_notes
            else ""
        )
        + "</Types>"
    )
    rels = (
        f'<Relationships xmlns="{RELS}">'
        f'<Relationship Id="rId1" Type="{DOC_RELS}/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    doc_rels = (
        f'<Relationships xmlns="{RELS}">'
        f'<Relationship Id="rId1" Type="{DOC_RELS}/styles" Target="styles.xml"/>'
        f'<Relationship Id="rId2" Type="{DOC_RELS}/numbering" Target="numbering.xml"/>'
        + (f'<Relationship Id="rId3" Type="{DOC_RELS}/footnotes" Target="footnotes.xml"/>' if with_notes else "")
        + "</Relationships>"
    )
    document = f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr/></w:body></w:document>'
    styles_xml = (
        f'<w:styles xmlns:w="{W}">'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        f"{styles}</w:styles>"
    )
    files = [
        ("[Content_Types].xml", content_types.encode()),
        ("_rels/.rels", rels.encode()),
        ("word/_rels/document.xml.rels", doc_rels.encode()),
        ("word/document.xml", document.encode()),
        ("word/styles.xml", styles_xml.encode()),
        ("word/numbering.xml", NUMBERING.encode()),
    ]
    if with_notes:
        files.append(("word/footnotes.xml", FOOTNOTES.encode()))
    write_zip(path, files)


FRENCH_WORD_STYLES = style("Titre", "Title") + style("Titre1", "heading 1") + style("Titre2", "heading 2")

TDR_TITRES = "".join(
    [
        styled("Titre", "Termes de référence"),
        text("Étude de la gestion des déchets à Porto-Novo."),
        styled("Titre1", "Contexte et justification"),
        paragraph(
            run("La commune produit 300 tonnes de déchets par jour")
            + '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>'
            + run(".")
        ),
        styled("Titre1", "Objectifs de l'étude"),
        text("Cette partie présente les objectifs."),
        styled("Titre2", "Objectif général"),
        text("Rappeler l'objectif général en une phrase."),
        styled("Titre2", "Objectifs spécifiques"),
        text("Lister les objectifs spécifiques :"),
        list_item(1, 0, "évaluer la collecte ;"),
        list_item(1, 0, "proposer un plan d'action."),
        styled("Titre1", "Méthodologie"),
        styled("Titre1", "Livrables attendus"),
        text("Un rapport provisoire puis un rapport final."),
    ]
)

NAMED_STYLES = style("Titre1", "Titre 1") + style("Titre2", "Titre 2")

TDR_STYLES_NOMMES = "".join(
    [
        styled("Titre1", "Présentation du projet"),
        text("Le projet couvre trois communes."),
        styled("Titre2", "Zone d'intervention"),
        styled("Titre1", "Résultats attendus"),
    ]
)

TDR_NUMEROTE = "".join(
    [
        text("TERMES DE RÉFÉRENCE"),
        text("Recrutement d'un cabinet pour l'évaluation finale du projet."),
        text("I. CONTEXTE"),
        text("Le projet a démarré en 2021 dans le Zou."),
        text("II. OBJECTIFS DE LA MISSION"),
        text("A. Objectif général"),
        text("Apprécier les résultats du projet."),
        text("B. Objectifs spécifiques"),
        text("Le consultant devra notamment :"),
        text("1. analyser les données de suivi ;"),
        text("2. rencontrer les bénéficiaires ;"),
        text("III. MÉTHODOLOGIE"),
        text("A. Revue documentaire"),
        text("B. Entretiens"),
        text("IV. CALENDRIER"),
        text("La mission dure 30 jours."),
    ]
)

TDR_MD = """# Termes de référence

Évaluation à mi-parcours du programme **Eau pour tous**.

## 1. Contexte

Le programme couvre *douze* communes.

## 2. Objectifs

### 2.1 Objectif général

Mesurer l'avancement.

### 2.2 Objectifs spécifiques

- Vérifier les indicateurs.
- Recueillir l'avis des usagers.

#### Indicateurs suivis

Taux d'accès à l'eau potable.

## 3. Livrables
"""

TDR_TXT = """TERMES DE REFERENCE

1. Contexte
Le projet accompagne 40 coopératives.

2. Objectifs
2.1 Objectif général
Renforcer les coopératives.
2.2 Objectifs spécifiques
Les objectifs sont :
1. former les membres ;
2. équiper les ateliers.

3. Méthodologie
3.1 Collecte des données
3.2 Analyse
2024. Une enquête de référence a eu lieu.

4. Profil du consultant
"""

PDF_PAGES = [
    [
        "TERMES DE RÉFÉRENCE",
        "Évaluation du programme d'alphabétisation",
        "1. Contexte",
        "Le programme touche 12 000 adultes dans l'Atacora.",
        "2. Objectifs",
        "2.1 Objectif général",
        "Mesurer les acquis des apprenants.",
    ],
    [
        "2.2 Objectifs spécifiques",
        "3. Méthodologie",
        "Enquête auprès de 600 apprenants.",
        "4. Livrables",
    ],
]


def pdf_string(value: str) -> bytes:
    raw = value.encode("cp1252")
    return b"(" + raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b")"


def pdf(path: Path, pages: list[list[str]]) -> None:
    """A small PDF: one Helvetica font in WinAnsiEncoding, one text block per page."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog = add(b"")
    pages_id = add(b"")
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    page_ids = []
    for lines in pages:
        content = b"BT /F1 12 Tf 16 TL 72 770 Td " + b" ".join(pdf_string(line) + b" Tj T*" for line in lines) + b" ET"
        stream = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        page_ids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id, font, stream)
            )
        )
    objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id
    kids = b" ".join(b"%d 0 R" % page for page in page_ids)
    objects[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, catalog, xref)
    path.write_bytes(bytes(out))


def main() -> None:
    docx(HERE / "tdr-titres.docx", TDR_TITRES, FRENCH_WORD_STYLES, with_notes=True)
    docx(HERE / "tdr-styles-nommes.docx", TDR_STYLES_NOMMES, NAMED_STYLES)
    docx(HERE / "tdr-numerote.docx", TDR_NUMEROTE, "")
    (HERE / "tdr.md").write_text(TDR_MD, encoding="utf-8")
    (HERE / "tdr.txt").write_bytes(TDR_TXT.replace("\n", "\r\n").encode("cp1252"))
    pdf(HERE / "tdr.pdf", PDF_PAGES)


if __name__ == "__main__":
    main()
