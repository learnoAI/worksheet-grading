export default function Loading() {
    return (
        <div className="flex min-h-screen items-center justify-center">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <h2 className="text-xl font-semibold">Loading...</h2>
                <p className="text-gray-600 mt-2">Please wait while we prepare your dashboard</p>
            </div>
        </div>
    );
}
