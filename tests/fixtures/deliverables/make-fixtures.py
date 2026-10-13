#!/usr/bin/env python3
"""Builds the deliverable parser fixtures in this folder.

Run it from anywhere: python3 tests/fixtures/deliverables/make-fixtures.py
Standard library only. Every ZIP entry has a fixed date and fixed attributes,
so the files come out the same on every run.

- etude-thermique.docx: headings, emphasis, a link, an image, nested lists
  and a table with merged cells, in French.
- illisible.docx: the ZIP signature followed by bytes that are not a ZIP.
- releves.csv: Excel style CSV, Windows-1252, ";" between values, CRLF.
"""

from __future__ import annotations

import struct
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXED_DATE = (1980, 1, 1, 0, 0, 0)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"
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


def tiny_png() -> bytes:
    """A 1x1 red PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = zlib.compress(b"\x00\xff\x00\x00", 9)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")


def run(text: str, props: str = "") -> str:
    rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


def paragraph(content: str, ppr: str = "") -> str:
    return f"<w:p>{f'<w:pPr>{ppr}</w:pPr>' if ppr else ''}{content}</w:p>"


def styled(style: str, text: str) -> str:
    return paragraph(run(text), f'<w:pStyle w:val="{style}"/>')


def list_item(num_id: int, level: int, text: str) -> str:
    return paragraph(run(text), f'<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num_id}"/></w:numPr>')


def cell(text: str, tcpr: str = "") -> str:
    props = f"<w:tcPr>{tcpr}</w:tcPr>" if tcpr else ""
    return f"<w:tc>{props}{paragraph(run(text) if text else '')}</w:tc>"


IMAGE = (
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
    '<wp:extent cx="952500" cy="952500"/>'
    '<wp:docPr id="1" name="Image 1" descr="Plan du bâtiment"/>'
    f'<a:graphic><a:graphicData uri="{PIC}"><pic:pic>'
    '<pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>'
    '<pic:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
)

TABLE = (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>'
    "<w:tr><w:trPr><w:tblHeader/></w:trPr>"
    + cell("Zone")
    + cell("Température")
    + cell("Humidité")
    + "</w:tr><w:tr>"
    + cell("Façade nord", '<w:vMerge w:val="restart"/>')
    + cell("24,5 °C")
    + cell("60 %")
    + "</w:tr><w:tr>"
    + cell("", "<w:vMerge/>")
    + cell("Capteur en panne", '<w:gridSpan w:val="2"/>')
    + "</w:tr><w:tr>"
    + cell("Toiture")
    + cell("38 °C")
    + cell("35 %")
    + "</w:tr></w:tbl>"
)

BODY = "".join(
    [
        styled("Heading1", "Étude thermique du bâtiment"),
        paragraph(
            run(
                "Le maître d'œuvre a mesuré la façade sud à Porto-Novo : "
                "«chaleur très élevée» en après-midi, pour un coût de 1 000,50 €."
            )
        ),
        styled("Heading2", "Constats"),
        paragraph(
            run("Le confort d'été est ")
            + run("très faible", "<w:b/>")
            + run(" dans les ")
            + run("chambres du nord", "<w:i/>")
            + run(", voir le ")
            + f'<w:hyperlink r:id="rId3">{run("rapport complet")}</w:hyperlink>'
            + run(" et l'")
            + run("ancienne étude", "<w:strike/>")
            + run(".")
        ),
        paragraph(run("Plan : ") + IMAGE),
        list_item(1, 0, "Murs extérieurs"),
        list_item(1, 1, "Isolation en laine de roche"),
        list_item(1, 1, "Enduit à la chaux"),
        list_item(1, 0, "Toiture en tôle"),
        paragraph(run("Étapes de l'étude :")),
        list_item(2, 0, "Mesurer les températures"),
        list_item(2, 0, "Calculer les apports solaires"),
        list_item(2, 0, "Rédiger les recommandations"),
        styled("Heading2", "Mesures"),
        TABLE,
        paragraph(run("Fin du rapport.")),
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
    ]
)

DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}">'
    f"<w:body>{BODY}</w:body></w:document>"
)

STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<w:styles xmlns:w="{W}">'
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>'
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/></w:style>'
    "</w:styles>"
)


def level(index: int, fmt: str, text: str) -> str:
    return (
        f'<w:lvl w:ilvl="{index}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/>'
        f'<w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/></w:lvl>'
    )


NUMBERING = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<w:numbering xmlns:w="{W}">'
    '<w:abstractNum w:abstractNumId="0">'
    + level(0, "bullet", "•")
    + level(1, "bullet", "o")
    + "</w:abstractNum>"
    '<w:abstractNum w:abstractNumId="1">'
    + level(0, "decimal", "%1.")
    + "</w:abstractNum>"
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>'
    "</w:numbering>"
)

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Default Extension="png" ContentType="image/png"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    '<Override PartName="/word/numbering.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    "</Types>"
)

PACKAGE_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<Relationships xmlns="{RELS}">'
    f'<Relationship Id="rId1" Type="{DOC_RELS}/officeDocument" Target="word/document.xml"/>'
    "</Relationships>"
)

DOCUMENT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<Relationships xmlns="{RELS}">'
    f'<Relationship Id="rId1" Type="{DOC_RELS}/styles" Target="styles.xml"/>'
    f'<Relationship Id="rId2" Type="{DOC_RELS}/numbering" Target="numbering.xml"/>'
    f'<Relationship Id="rId3" Type="{DOC_RELS}/hyperlink" Target="https://exemple.bj/rapport" '
    'TargetMode="External"/>'
    f'<Relationship Id="rId4" Type="{DOC_RELS}/image" Target="media/image1.png"/>'
    "</Relationships>"
)


def make_docx() -> None:
    write_zip(
        HERE / "etude-thermique.docx",
        [
            ("[Content_Types].xml", CONTENT_TYPES.encode()),
            ("_rels/.rels", PACKAGE_RELS.encode()),
            ("word/document.xml", DOCUMENT.encode()),
            ("word/_rels/document.xml.rels", DOCUMENT_RELS.encode()),
            ("word/styles.xml", STYLES.encode()),
            ("word/numbering.xml", NUMBERING.encode()),
            ("word/media/image1.png", tiny_png()),
        ],
    )


def make_unreadable_docx() -> None:
    # Bytes step by 37, so "PK" never shows up again and there is no
    # end of central directory record to find.
    data = b"PK\x03\x04" + bytes((index * 37 + 11) % 256 for index in range(2048))
    assert data.count(b"PK") == 1
    (HERE / "illisible.docx").write_bytes(data)


def make_csv() -> None:
    lines = [
        "Point de mesure;Température (°C);Humidité (%);Remarque",
        "Façade nord;24,5;60;RAS",
        'Façade sud;31,2;45;"Soleil direct; volets ""ouverts"""',
        "Toiture;38;35;Coût 1 000,50 €, œuvre à reprendre",
    ]
    (HERE / "releves.csv").write_bytes("".join(f"{line}\r\n" for line in lines).encode("cp1252"))


if __name__ == "__main__":
    make_docx()
    make_unreadable_docx()
    make_csv()
