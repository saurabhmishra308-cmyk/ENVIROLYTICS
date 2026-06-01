from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.pdfgen import canvas
from datetime import datetime
import io

class CertificateGenerator:
    """Generate calibration and installation certificates."""
    
    @staticmethod
    def generate_calibration_certificate(data: dict) -> bytes:
        """Generate calibration certificate PDF."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        elements = []
        styles = getSampleStyleSheet()
        
        # Custom styles
        title_style = ParagraphStyle(
            'CertTitle',
            parent=styles['Heading1'],
            fontSize=20,
            textColor=colors.HexColor('#1a2332'),
            spaceAfter=10,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
        
        header_style = ParagraphStyle(
            'Header',
            parent=styles['Normal'],
            fontSize=14,
            textColor=colors.HexColor('#4a9fd8'),
            spaceAfter=20,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
        
        # Header
        elements.append(Paragraph("ENVIROLYTICS", header_style))
        elements.append(Paragraph("Sustainability Private Limited", styles['Normal']))
        elements.append(Paragraph("CIN: U26510UP2026PTC247017", styles['Normal']))
        elements.append(Spacer(1, 0.3*inch))
        
        # Certificate Title
        elements.append(Paragraph("CALIBRATION CERTIFICATE", title_style))
        elements.append(Spacer(1, 0.2*inch))
        
        # Certificate Number
        cert_num_style = ParagraphStyle('CertNum', parent=styles['Normal'], fontSize=11, alignment=TA_RIGHT)
        elements.append(Paragraph(f"<b>Certificate No:</b> {data.get('certificate_number', 'N/A')}", cert_num_style))
        elements.append(Spacer(1, 0.3*inch))
        
        # Instrument Details
        info_data = [
            ['Instrument Type:', data.get('instrument_type', 'N/A')],
            ['Serial Number:', data.get('serial_number', 'N/A')],
            ['Instrument ID:', data.get('instrument_id', 'N/A')],
            ['Calibration Date:', data.get('calibration_date', datetime.now()).strftime('%d-%m-%Y')],
            ['Next Calibration:', data.get('next_calibration_date', datetime.now()).strftime('%d-%m-%Y')],
            ['Calibrated By:', data.get('calibrated_by', 'Envirolytics Team')],
        ]
        
        info_table = Table(info_data, colWidths=[2.5*inch, 3.5*inch])
        info_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e8e8e8')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
            ('ALIGN', (1, 0), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 11),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 1, colors.grey),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 0.3*inch))
        
        # Calibration Parameters
        elements.append(Paragraph("<b>Calibration Parameters</b>", styles['Heading2']))
        elements.append(Spacer(1, 0.1*inch))
        
        params = data.get('parameters', {})
        param_data = [['Parameter', 'Standard Value', 'Measured Value', 'Deviation', 'Status']]
        
        for param_name, param_values in params.items():
            param_data.append([
                param_name,
                str(param_values.get('standard', '-')),
                str(param_values.get('measured', '-')),
                str(param_values.get('deviation', '-')),
                param_values.get('status', 'Pass')
            ])
        
        param_table = Table(param_data, colWidths=[1.5*inch, 1.2*inch, 1.2*inch, 1.2*inch, 1*inch])
        param_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4a9fd8')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
        ]))
        elements.append(param_table)
        elements.append(Spacer(1, 0.4*inch))
        
        # Remarks
        elements.append(Paragraph("<b>Remarks:</b> The instrument has been calibrated as per standard procedures and found to be within acceptable limits.", styles['Normal']))
        elements.append(Spacer(1, 0.3*inch))
        
        # Footer
        footer_data = [
            ['__________________', '__________________'],
            ['Technician Signature', 'Authorized Signature'],
            ['', ''],
            ['Envirolytics Sustainability Pvt Ltd', 'Contact: +91 83180 62553'],
            ['Lucknow, Uttar Pradesh, India', 'Email: envirolytics.official@gmail.com']
        ]
        
        footer_table = Table(footer_data, colWidths=[3*inch, 3*inch])
        footer_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(footer_table)
        
        doc.build(elements)
        return buffer.getvalue()
    
    @staticmethod
    def generate_installation_certificate(data: dict) -> bytes:
        """Generate installation certificate PDF."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
        elements = []
        styles = getSampleStyleSheet()
        
        # Custom styles
        title_style = ParagraphStyle(
            'CertTitle',
            parent=styles['Heading1'],
            fontSize=20,
            textColor=colors.HexColor('#1a2332'),
            spaceAfter=10,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
        
        header_style = ParagraphStyle(
            'Header',
            parent=styles['Normal'],
            fontSize=14,
            textColor=colors.HexColor('#4a9fd8'),
            spaceAfter=20,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        )
        
        # Header
        elements.append(Paragraph("ENVIROLYTICS", header_style))
        elements.append(Paragraph("Sustainability Private Limited", styles['Normal']))
        elements.append(Paragraph("CIN: U26510UP2026PTC247017", styles['Normal']))
        elements.append(Spacer(1, 0.3*inch))
        
        # Certificate Title
        elements.append(Paragraph("INSTALLATION CERTIFICATE", title_style))
        elements.append(Spacer(1, 0.2*inch))
        
        # Certificate Number
        cert_num_style = ParagraphStyle('CertNum', parent=styles['Normal'], fontSize=11, alignment=TA_RIGHT)
        elements.append(Paragraph(f"<b>Certificate No:</b> {data.get('certificate_number', 'N/A')}", cert_num_style))
        elements.append(Spacer(1, 0.3*inch))
        
        # Installation Details
        info_data = [
            ['Client Name:', data.get('client_name', 'N/A')],
            ['Instrument Type:', data.get('instrument_type', 'N/A')],
            ['Serial Number:', data.get('serial_number', 'N/A')],
            ['Instrument ID:', data.get('instrument_id', 'N/A')],
            ['Installation Location:', data.get('location', 'N/A')],
            ['Installation Date:', data.get('installation_date', datetime.now()).strftime('%d-%m-%Y')],
            ['Installed By:', data.get('installed_by', 'Envirolytics Team')],
        ]
        
        info_table = Table(info_data, colWidths=[2.5*inch, 3.5*inch])
        info_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e8e8e8')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
            ('ALIGN', (1, 0), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 11),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 1, colors.grey),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 0.3*inch))
        
        # Installation Checklist
        elements.append(Paragraph("<b>Installation Checklist</b>", styles['Heading2']))
        elements.append(Spacer(1, 0.1*inch))
        
        checklist = [
            ['Item', 'Status'],
            ['Site survey completed', '✓'],
            ['Instrument physically installed', '✓'],
            ['Power supply connected', '✓'],
            ['MQTT connectivity configured', '✓'],
            ['Initial testing completed', '✓'],
            ['Client training provided', '✓'],
            ['Documentation handed over', '✓'],
        ]
        
        checklist_table = Table(checklist, colWidths=[4*inch, 1.5*inch])
        checklist_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4a9fd8')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
        ]))
        elements.append(checklist_table)
        elements.append(Spacer(1, 0.3*inch))
        
        # Warranty Information
        elements.append(Paragraph("<b>Warranty:</b> This instrument is covered under manufacturer warranty for 12 months from the date of installation.", styles['Normal']))
        elements.append(Spacer(1, 0.3*inch))
        
        # Footer
        footer_data = [
            ['__________________', '__________________'],
            ['Installer Signature', 'Client Signature'],
            ['', ''],
            ['Envirolytics Sustainability Pvt Ltd', 'Contact: +91 83180 62553'],
            ['Lucknow, Uttar Pradesh, India', 'Email: envirolytics.official@gmail.com']
        ]
        
        footer_table = Table(footer_data, colWidths=[3*inch, 3*inch])
        footer_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(footer_table)
        
        doc.build(elements)
        return buffer.getvalue()
