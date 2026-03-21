import os
from dotenv import load_dotenv
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    RunReportRequest,
)

def run_report(property_id):
    """Runs a simple report on a Google Analytics 4 property."""
    client = BetaAnalyticsDataClient()

    request = RunReportRequest(
        property=f"properties/{property_id}",
        dimensions=[Dimension(name="date")],
        metrics=[Metric(name="sessions"), Metric(name="activeUsers")],
        date_ranges=[DateRange(start_date="7daysAgo", end_date="today")],
    )
    
    try:
        response = client.run_report(request)
        
        print("\nGA4 Traffic Report (Last 7 Days)")
        print("-" * 50)
        print(f"{'Date':<15} | {'Sessions':<10} | {'Active Users':<12}")
        print("-" * 50)
        
        for row in response.rows:
            date = row.dimension_values[0].value
            sessions = row.metric_values[0].value
            active_users = row.metric_values[1].value
            print(f"{date:<15} | {sessions:<10} | {active_users:<12}")
            
    except Exception as e:
        print(f"\nError running GA4 report: {e}")
        if "Google Analytics Data API has not been used" in str(e):
            print("\nTIP: You need to enable the Analytics Data API in your Google Cloud Project.")
            print("Link: https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com")

if __name__ == "__main__":
    load_dotenv()
    property_id = os.getenv("GA4_PROPERTY_ID")
    if not property_id:
        print("Error: GA4_PROPERTY_ID not found in .env file.")
    else:
        run_report(property_id)
