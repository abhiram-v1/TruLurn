from pymongo import MongoClient

uri = "mongodb+srv://Abhiram235:<Abhi6302@ram>@trulurn.wwe6zxb.mongodb.net/"

client = MongoClient(uri)

print(client.list_database_names())