import os
import json
import psycopg2
from datetime import datetime
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

# Load environment variables from backend directory
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, '.env')
load_dotenv(env_path)

# Database connection parameters
DATABASE_URL = os.getenv('DATABASE_URL')

def clean_database_url(url):
    """
    Remove Prisma-specific parameters that psycopg2 doesn't support
    """
    if not url:
        raise ValueError("DATABASE_URL not found in environment variables")
    
    # Parse the URL
    parsed = urlparse(url)
    
    # Parse query parameters
    query_params = parse_qs(parsed.query)
    
    # Remove Prisma-specific parameters
    prisma_params = ['connection_limit', 'pool_timeout', 'connect_timeout', 'socket_timeout']
    for param in prisma_params:
        query_params.pop(param, None)
    
    # Rebuild query string
    new_query = urlencode(query_params, doseq=True)
    
    # Rebuild URL
    cleaned_url = urlunparse((
        parsed.scheme,
        parsed.netloc,
        parsed.path,
        parsed.params,
        new_query,
        parsed.fragment
    ))
    
    return cleaned_url

DATABASE_URL = clean_database_url(DATABASE_URL)

def extract_admin_comments(start_date, end_date, output_file='admin_comments.json'):
    """
    Extract admin comments from worksheets within a date range.
    
    Args:
        start_date: Start date in 'YYYY-MM-DD' format
        end_date: End date in 'YYYY-MM-DD' format
        output_file: Output JSON file name
    """
    try:
        # Connect to the database
        print(f"Connecting to database...")
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        # Query to fetch worksheets with admin comments
        query = """
            SELECT 
                w.id,
                w."adminComments",
                w."createdAt",
                w."updatedAt",
                w."submittedOn",
                w.grade,
                w."outOf",
                w."isIncorrectGrade",
                w."isCorrectGrade",
                w."wrongQuestionNumbers",
                w."mongoDbId",
                wt."worksheetNumber",
                u.name as student_name,
                u.username as student_username,
                c.name as class_name,
                s.name as school_name
            FROM "Worksheet" w
            LEFT JOIN "User" u ON w."studentId" = u.id
            LEFT JOIN "Class" c ON w."classId" = c.id
            LEFT JOIN "School" s ON c."schoolId" = s.id
            LEFT JOIN "WorksheetTemplate" wt ON w."templateId" = wt.id
            WHERE w."adminComments" IS NOT NULL 
            AND w."adminComments" != ''
            AND w."createdAt" >= %s::timestamp
            AND w."createdAt" < (%s::timestamp + INTERVAL '1 day')
            ORDER BY w."createdAt" DESC
        """
        
        print(f"Fetching admin comments from {start_date} to {end_date}...")
        cursor.execute(query, (start_date, end_date))
        
        # Fetch all results
        columns = [desc[0] for desc in cursor.description]
        results = cursor.fetchall()
        
        # Convert to list of dictionaries
        admin_comments_data = []
        for row in results:
            record = dict(zip(columns, row))
            # Convert datetime objects to ISO format strings
            for key, value in record.items():
                if isinstance(value, datetime):
                    record[key] = value.isoformat()
            admin_comments_data.append(record)
        
        # Close database connection
        cursor.close()
        conn.close()
        
        print(f"Found {len(admin_comments_data)} worksheets with admin comments")
        
        # Write to JSON file
        output_path = os.path.join(os.path.dirname(__file__), '..', output_file)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(admin_comments_data, f, indent=2, ensure_ascii=False)
        
        print(f"Admin comments extracted successfully to {output_path}")
        
        # Print summary
        print("\n=== Summary ===")
        print(f"Total records: {len(admin_comments_data)}")
        print(f"Date range: {start_date} to {end_date}")
        
        return admin_comments_data
        
    except Exception as e:
        print(f"Error: {str(e)}")
        raise

if __name__ == "__main__":
    # Extract admin comments from November 1 to November 12, 2025
    start_date = "2025-11-01"
    end_date = "2025-11-12"
    
    extract_admin_comments(start_date, end_date)
