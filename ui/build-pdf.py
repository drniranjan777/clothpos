"""Render every UI screen to a 1440x900 PDF page with headless Chrome and merge them.
Usage: python build-pdf.py   ->  ../Clothing-POS-UI-Screens.pdf
"""
import os, subprocess, tempfile
from pypdf import PdfWriter

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "Clothing-POS-UI-Screens.pdf")
SCREENS = ["index", "pos-billing", "pos-payment", "invoice", "dashboard", "products", "inventory",
           "customers", "returns", "shift-closing", "reports", "sa-dashboard", "sa-tenants", "sa-plans", "login"]

tmp = tempfile.mkdtemp()
writer = PdfWriter()
for name in SCREENS:
    pdf = os.path.join(tmp, name + ".pdf")
    url = "file:///" + os.path.join(HERE, name + ".html").replace("\\", "/")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--window-size=1440,900", "--virtual-time-budget=5000",
                    f"--user-data-dir={tmp}\prof", f"--print-to-pdf={pdf}", url],
                   check=True, capture_output=True)
    writer.append(pdf, pages=(0, 1))  # one screen = one page
    print("ok", name)
writer.write(OUT)
print("wrote", OUT)
